// Tari Arisan — a rotating savings circle (arisan) enforced by a Tari smart contract.
//
// SPDX-License-Identifier: MIT
//
// Rules (v1) — see README.md for the plain-language version:
// 1. A circle has a fixed member list (payout order), a fixed contribution per
//    round, a total number of rounds, and a round length in Ootle epochs.
// 2. Every member owes exactly `contribution` per round. `contribute` only
//    accepts the exact amount, only for the current round, only once per
//    (round, member), and only from a member.
// 3. `close_round` (anyone, once the round deadline epoch is reached):
//    - members who did not pay this round get `arrears += contribution`.
//    - if the round's recipient is clear (no arrears), the whole vault
//      balance is paid to their account.
//    - if the recipient is in arrears, the payout is skipped: the pot stays
//      in the vault and rolls over to the next round's recipient. The
//      deferred member can restore standing with `pay_arrears` before their
//      next turn comes around; a missed turn is not paid out later.
//    - the round advances and the next deadline is set. After the last
//      round the circle is finished.
// 4. `pay_arrears` lets a member in arrears clear the full amount owed with
//    one exact payment into the vault.
// 5. No owner/admin methods, no owner resource tricks: every mutating method
//    is `allow_all` and membership is enforced in code. The template can
//    never be upgraded (UpdateRule::Locked).

use tari_template_lib::prelude::*;

#[template]
mod tari_arisan {
    use std::collections::HashMap;

    use super::*;

    /// The component: one per circle. The FIRST pub struct in the module
    /// names the template, so this must stay first.
    pub struct TariArisan {
        /// Members in payout order: round `r` pays `members[r % members.len()]`.
        members: Vec<Member>,
        /// Fixed contribution per member per round, in micro-TARI (µT).
        contribution: Amount,
        /// Total number of rounds the circle runs for.
        rounds_per_circle: u32,
        /// Length of one round, in Ootle epochs.
        round_length_epochs: u64,
        /// Current round index, 0-based.
        round: u32,
        /// Epoch at which the current round may be closed.
        round_deadline_epoch: u64,
        /// (round, member) -> paid. Only the current round is ever written.
        paid: HashMap<(u32, RistrettoPublicKeyBytes), bool>,
        /// member -> total amount owed from missed rounds (µT).
        arrears: HashMap<RistrettoPublicKeyBytes, Amount>,
        /// The pot: every contribution and arrears payment lands here.
        vault: Vault,
        /// The native TARI resource the vault holds.
        tari_resource: ResourceAddress,
        /// Whoever created the circle (recorded for transparency only;
        /// the creator has no special powers).
        creator: RistrettoPublicKeyBytes,
    }

    /// One member of a circle: their signing key (identity) and the account
    /// component that receives their payout.
    pub struct Member {
        pub pubkey: RistrettoPublicKeyBytes,
        pub account: ComponentAddress,
    }

    /// Public snapshot of a circle, returned by `info()`.
    pub struct CircleInfo {
        pub members: Vec<RistrettoPublicKeyBytes>,
        pub contribution: Amount,
        pub rounds_per_circle: u32,
        pub round_length_epochs: u64,
        pub round: u32,
        pub round_deadline_epoch: u64,
        pub is_finished: bool,
        pub vault_balance: Amount,
        pub tari_resource: ResourceAddress,
        pub creator: RistrettoPublicKeyBytes,
    }

    impl TariArisan {
        /// Creates a new circle. The creator pays nothing up front.
        /// The pot vault holds the native TARI token (`TARI_TOKEN`).
        /// Members are given as parallel vectors: `member_pubkeys[i]` is
        /// the signing key of the member whose payout account is
        /// `member_accounts[i]`.
        ///
        /// # Panics
        /// Panics if the two member vectors differ in length, if there are
        /// fewer than 2 or more than 64 members, if the contribution is
        /// zero, if `rounds_per_circle` is zero, if the round length is
        /// outside 1..=1008 epochs, or if a member appears twice.
        pub fn new(
            member_pubkeys: Vec<RistrettoPublicKeyBytes>,
            member_accounts: Vec<ComponentAddress>,
            contribution: Amount,
            rounds_per_circle: u32,
            round_length_epochs: u64,
        ) -> Component<Self> {
            assert_eq!(
                member_pubkeys.len(),
                member_accounts.len(),
                "Member pubkeys and accounts must have the same length"
            );
            let members: Vec<Member> = member_pubkeys
                .into_iter()
                .zip(member_accounts.into_iter())
                .map(|(pubkey, account)| Member { pubkey, account })
                .collect();
            assert!(
                members.len() >= 2,
                "Arisan needs at least 2 members"
            );
            assert!(members.len() <= 64, "Arisan supports at most 64 members");
            assert!(!contribution.is_zero(), "Contribution must be greater than zero");
            assert!(rounds_per_circle > 0, "Circle must run for at least 1 round");
            assert!(
                (1..=1008).contains(&round_length_epochs),
                "Round length must be between 1 and 1008 epochs"
            );
            let mut seen: Vec<RistrettoPublicKeyBytes> = Vec::new();
            for m in &members {
                assert!(
                    !seen.contains(&m.pubkey),
                    "Duplicate member in circle"
                );
                seen.push(m.pubkey);
            }

            let creator = CallerContext::transaction_signer_public_key();
            let deadline = Consensus::current_epoch() + round_length_epochs;

            let access_rules = ComponentAccessRules::new()
                .method("contribute", rule![allow_all])
                .method("close_round", rule![allow_all])
                .method("pay_arrears", rule![allow_all])
                .method("info", rule![allow_all])
                .default(rule![deny_all]);

            Component::new(Self {
                members,
                contribution,
                rounds_per_circle,
                round_length_epochs,
                round: 0,
                round_deadline_epoch: deadline,
                paid: HashMap::new(),
                arrears: HashMap::new(),
                vault: Vault::new_empty(TARI_TOKEN),
                tari_resource: TARI_TOKEN,
                creator,
            })
            .with_access_rules(access_rules)
            .with_upgrade_rule(UpdateRule::Locked)
            .create()
        }

        /// Contribute exactly `contribution` to the current round.
        ///
        /// Callable by: any member, for the current round only.
        ///
        /// # Panics
        /// Panics if the circle is finished, if `round` is not the current
        /// round, if the signer is not a member, if the member already paid
        /// this round, or if the payment is not exactly `contribution` of
        /// the circle's TARI resource.
        pub fn contribute(&mut self, round: u32, payment: Bucket) {
            assert!(!self.is_finished(), "Circle is finished");
            assert_eq!(round, self.round, "Can only contribute to the current round");
            let member = CallerContext::transaction_signer_public_key();
            assert!(self.is_member(&member), "Only a circle member can contribute");
            assert_eq!(
                payment.resource_address(),
                self.tari_resource,
                "Payment must be in TARI"
            );
            assert_eq!(
                payment.amount(),
                self.contribution,
                "Payment must be exactly the contribution amount"
            );
            assert!(
                self.paid.insert((round, member), true).is_none(),
                "Member already paid this round"
            );

            self.vault.deposit(payment);
            emit_event(
                "ContributionReceived",
                metadata![
                    "round" => round.to_string(),
                    "member" => member.to_string(),
                    "amount" => self.contribution.to_string(),
                ],
            );
        }

        /// Close the current round and pay the pot to its recipient.
        ///
        /// Callable by: anyone, once the round deadline epoch is reached.
        ///
        /// # Panics
        /// Panics if the circle is finished or if the round deadline epoch
        /// has not been reached yet.
        pub fn close_round(&mut self) {
            assert!(!self.is_finished(), "Circle is finished");
            let epoch = Consensus::current_epoch();
            assert!(
                epoch >= self.round_deadline_epoch,
                "Round cannot be closed before its deadline epoch"
            );

            let round = self.round;
            let recipient_idx = (round as usize) % self.members.len();
            let recipient_pubkey = self.members[recipient_idx].pubkey;
            let recipient_account = self.members[recipient_idx].account;

            // Everyone who did not pay this round falls into arrears.
            for m in &self.members {
                if !self.paid.contains_key(&(round, m.pubkey)) {
                    let owed = self
                        .arrears
                        .get(&m.pubkey)
                        .copied()
                        .unwrap_or_else(|| Amount::new(0));
                    let owed = owed
                        .checked_add(self.contribution)
                        .expect("Arrears overflow");
                    self.arrears.insert(m.pubkey, owed);
                    emit_event(
                        "ArrearsRecorded",
                        metadata![
                            "round" => round.to_string(),
                            "member" => m.pubkey.to_string(),
                            "amount" => self.contribution.to_string(),
                        ],
                    );
                }
            }

            let recipient_arrears = self
                .arrears
                .get(&recipient_pubkey)
                .copied()
                .unwrap_or_else(|| Amount::new(0));
            let pot = self.vault.balance();

            if recipient_arrears.is_zero() && !pot.is_zero() {
                let payout = self.vault.withdraw(pot);
                ComponentManager::get(recipient_account).invoke("deposit", args![payout]);
                emit_event(
                    "RoundClosed",
                    metadata![
                        "round" => round.to_string(),
                        "recipient" => recipient_pubkey.to_string(),
                        "amount" => pot.to_string(),
                        "deferred" => "false",
                    ],
                );
            } else {
                // Recipient in arrears (or an empty pot): no payout this
                // round. The pot stays in the vault and rolls over to the
                // next round's recipient.
                emit_event(
                    "RoundClosed",
                    metadata![
                        "round" => round.to_string(),
                        "recipient" => recipient_pubkey.to_string(),
                        "amount" => Amount::new(0).to_string(),
                        "deferred" => "true",
                    ],
                );
            }

            // Advance the round. The `paid` map is keyed by round, so last
            // round's entries simply stop being consulted.
            self.round += 1;
            self.round_deadline_epoch += self.round_length_epochs;
        }

        /// Clear a member's full arrears with one exact payment.
        ///
        /// Callable by: any member who owes arrears.
        ///
        /// # Panics
        /// Panics if the circle is finished, if the signer is not a member,
        /// if the member owes no arrears, or if the payment is not exactly
        /// the amount owed.
        pub fn pay_arrears(&mut self, payment: Bucket) {
            assert!(!self.is_finished(), "Circle is finished");
            let member = CallerContext::transaction_signer_public_key();
            assert!(self.is_member(&member), "Only a circle member can pay arrears");
            let owed = self
                .arrears
                .get(&member)
                .copied()
                .unwrap_or_else(|| Amount::new(0));
            assert!(!owed.is_zero(), "Member has no arrears to pay");
            assert_eq!(
                payment.resource_address(),
                self.tari_resource,
                "Payment must be in TARI"
            );
            assert_eq!(payment.amount(), owed, "Payment must be exactly the amount owed");

            self.vault.deposit(payment);
            self.arrears.remove(&member);
            emit_event(
                "ArrearsPaid",
                metadata![
                    "member" => member.to_string(),
                    "amount" => owed.to_string(),
                ],
            );
        }

        /// Public read-only snapshot of the circle, for the frontend and
        /// indexers. Callable by anyone.
        pub fn info(&self) -> CircleInfo {
            CircleInfo {
                members: self.members.iter().map(|m| m.pubkey).collect(),
                contribution: self.contribution,
                rounds_per_circle: self.rounds_per_circle,
                round_length_epochs: self.round_length_epochs,
                round: self.round,
                round_deadline_epoch: self.round_deadline_epoch,
                is_finished: self.is_finished(),
                vault_balance: self.vault.balance(),
                tari_resource: self.tari_resource,
                creator: self.creator,
            }
        }

        fn is_finished(&self) -> bool {
            self.round >= self.rounds_per_circle
        }

        fn is_member(&self, pubkey: &RistrettoPublicKeyBytes) -> bool {
            self.members.iter().any(|m| &m.pubkey == pubkey)
        }
    }
}
