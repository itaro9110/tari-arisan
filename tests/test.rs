// Tari Arisan — engine tests.
//
// SPDX-License-Identifier: MIT
//
// Every test runs against the real Ootle execution engine in-process
// (TemplateTest compiles the template to WASM). Fees are off by default in
// tests, so account balances move only by contributions, arrears and payouts.

use tari_template_lib::types::{
    Amount,
    ComponentAddress,
    constants::TARI_TOKEN,
    crypto::RistrettoPublicKeyBytes,
};
use tari_template_test_tooling::{
    TemplateTest,
    byte_type::ToByteType,
    crypto::RistrettoSecretKey,
    engine_types::{
        commit_result::RejectReason,
        virtual_substate::{VirtualSubstate, VirtualSubstateId},
    },
    support::assert_error::assert_reject_reason,
    template_lib_types::NonFungibleAddress,
    transaction::args,
};

const TEMPLATE_NAME: &str = "TariArisan";
/// 0.1 TARI per round per member.
const CONTRIBUTION: u64 = 100_000;
/// Funded test accounts start with this much (TemplateTest constant).
const INITIAL_BALANCE: u64 = 1_000_000_000;

struct MemberCtx {
    account: ComponentAddress,
    proof: NonFungibleAddress,
    secret: RistrettoSecretKey,
    pubkey: RistrettoPublicKeyBytes,
}

struct CircleCtx {
    circle: ComponentAddress,
    members: Vec<MemberCtx>,
}

fn set_epoch(test: &mut TemplateTest, epoch: u64) {
    test.set_virtual_substate(VirtualSubstateId::CurrentEpoch, VirtualSubstate::CurrentEpoch(epoch));
}

/// Creates `n` funded accounts and a circle with them as members.
/// Round length is `round_length` epochs; the circle runs `rounds` rounds.
fn setup_circle(test: &mut TemplateTest, n: usize, rounds: u32, round_length: u64) -> CircleCtx {
    let mut members = Vec::new();
    for _ in 0..n {
        let (account, proof, secret, public_key) = test.create_funded_account_with_keypair();
        members.push(MemberCtx {
            account,
            proof,
            secret,
            pubkey: public_key.to_byte_type(),
        });
    }
    let pubkeys: Vec<RistrettoPublicKeyBytes> = members.iter().map(|m| m.pubkey).collect();
    let accounts: Vec<ComponentAddress> = members.iter().map(|m| m.account).collect();

    let circle: ComponentAddress = test.call_function(
        TEMPLATE_NAME,
        "new",
        args![
            pubkeys,
            accounts,
            Amount::new(CONTRIBUTION as u128),
            rounds,
            round_length
        ],
        vec![test.owner_proof()],
    );
    CircleCtx { circle, members }
}

/// Contribute `amount` to `round` as `member` (withdraws from their account
/// and passes the bucket to the circle). Panics the test if the tx fails.
fn contribute_ok(
    test: &mut TemplateTest,
    circle: ComponentAddress,
    member: &MemberCtx,
    round: u32,
    amount: u64,
) {
    test.execute_expect_success(
        test.transaction()
            .call_method(member.account, "withdraw", args![TARI_TOKEN, amount])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "contribute", args![round, Workspace("payment")])
            .build_and_seal(&member.secret),
        vec![member.proof.clone()],
    );
}

/// Same as `contribute_ok` but expects the transaction to fail; returns the
/// reject reason so the caller can assert on the panic message.
fn contribute_fail(
    test: &mut TemplateTest,
    circle: ComponentAddress,
    member: &MemberCtx,
    round: u32,
    amount: u64,
) -> RejectReason {
    test.execute_expect_failure(
        test.transaction()
            .call_method(member.account, "withdraw", args![TARI_TOKEN, amount])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "contribute", args![round, Workspace("payment")])
            .build_and_seal(&member.secret),
        vec![member.proof.clone()],
    )
}

fn close_round_ok(test: &mut TemplateTest, circle: ComponentAddress) {
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "close_round", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
}

fn pay_arrears_ok(test: &mut TemplateTest, circle: ComponentAddress, member: &MemberCtx, amount: u64) {
    test.execute_expect_success(
        test.transaction()
            .call_method(member.account, "withdraw", args![TARI_TOKEN, amount])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "pay_arrears", args![Workspace("payment")])
            .build_and_seal(&member.secret),
        vec![member.proof.clone()],
    );
}

fn account_balance(test: &mut TemplateTest, member: &MemberCtx) -> Amount {
    test.execute_expect_success(
        test.transaction()
            .call_method(member.account, "balance", args![TARI_TOKEN])
            .build_and_seal(&member.secret),
        vec![member.proof.clone()],
    );
    test.expect_return::<Amount>(0)
}

#[test]
fn circle_creation_sets_initial_state() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    // The circle starts at round 0: contributing to round 0 works, and
    // contributing to round 1 does not.
    contribute_ok(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION);
    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[1], 1, CONTRIBUTION);
    assert_reject_reason(reason, "Can only contribute to the current round");
}

#[test]
fn full_circle_happy_path() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;

    // 4 rounds; round r pays member r. Everyone pays every round.
    for round in 0..4u32 {
        for member in &ctx.members {
            contribute_ok(&mut test, circle, member, round, CONTRIBUTION);
        }
        // Advance to the round deadline, then close.
        set_epoch(&mut test, ((round + 1) * 2) as u64);
        let result = test.execute_expect_success(
            test.transaction()
                .call_method(circle, "close_round", args![])
                .build_and_seal(test.secret_key()),
            vec![],
        );
        // A RoundClosed event is emitted for every close.
        assert!(
            result
                .finalize
                .events
                .iter()
                .any(|e| e.topic() == "TariArisan.RoundClosed"),
            "RoundClosed event missing for round {round}"
        );
    }

    // The circle is finished: one more close is rejected.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "close_round", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert_reject_reason(reason, "Circle is finished");
    // Everyone paid 4 x 100_000 and received the 400_000 pot exactly once.
    for member in &ctx.members {
        assert_eq!(account_balance(&mut test, member), Amount::new(INITIAL_BALANCE as u128));
    }
}

#[test]
fn wrong_amount_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION - 1);
    assert_reject_reason(reason, "Payment must be exactly the contribution amount");

    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION + 1);
    assert_reject_reason(reason, "Payment must be exactly the contribution amount");
}

#[test]
fn zero_amount_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 0, 0);
    assert_reject_reason(reason, "Payment must be exactly the contribution amount");
}

#[test]
fn non_member_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let (outsider_account, outsider_proof, outsider_secret, _) =
        test.create_funded_account_with_keypair();

    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(outsider_account, "withdraw", args![TARI_TOKEN, CONTRIBUTION])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(ctx.circle, "contribute", args![0u32, Workspace("payment")])
            .build_and_seal(&outsider_secret),
        vec![outsider_proof.clone()],
    );
    assert_reject_reason(reason, "Only a circle member can contribute");
}

#[test]
fn wrong_round_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    // Current round is 0; contributing to round 1 must fail.
    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 1, CONTRIBUTION);
    assert_reject_reason(reason, "Can only contribute to the current round");
}

#[test]
fn double_pay_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    contribute_ok(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION);
    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION);
    assert_reject_reason(reason, "Member already paid this round");
}

#[test]
fn early_close_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    // Deadline is epoch 2; epoch is still 0.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(ctx.circle, "close_round", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert_reject_reason(reason, "Round cannot be closed before its deadline epoch");

    // Exactly at the deadline epoch it succeeds.
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, ctx.circle);
    // Round 0 is over: contributing to it now fails.
    let reason = contribute_fail(&mut test, ctx.circle, &ctx.members[0], 0, CONTRIBUTION);
    assert_reject_reason(reason, "Can only contribute to the current round");
}

#[test]
fn arrears_recorded_and_turn_deferred() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;

    // Round 0 recipient is member 0. Everyone except member 0 pays.
    for member in &ctx.members[1..] {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, circle);

    // Member 0 received nothing this round (the pot stays in the vault
    // and rolls over — proven by the 800_000 payout in
    // arrears_payoff_restores_turn).
    assert_eq!(
        account_balance(&mut test, &ctx.members[0]),
        Amount::new(INITIAL_BALANCE as u128)
    );
    // Round 1 is open: member 1 can contribute to it.
    contribute_ok(&mut test, circle, &ctx.members[1], 1, CONTRIBUTION);
}

#[test]
fn arrears_payoff_restores_turn() {
    let mut test = TemplateTest::my_crate();
    // 5 rounds so member 0 gets a turn again in round 4.
    let ctx = setup_circle(&mut test, 4, 5, 2);
    let circle = ctx.circle;

    // Round 0: member 0 (recipient) does not pay -> deferred, pot 300_000.
    for member in &ctx.members[1..] {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, circle);

    // Member 0 clears the 100_000 arrears (vault now holds 400_000).
    pay_arrears_ok(&mut test, circle, &ctx.members[0], CONTRIBUTION);

    // Round 1: everyone pays -> vault 800_000, recipient member 1 gets it
    // (300_000 rollover + 100_000 arrears + 400_000 round-1 contributions).
    for member in &ctx.members {
        contribute_ok(&mut test, circle, member, 1, CONTRIBUTION);
    }
    set_epoch(&mut test, 4);
    close_round_ok(&mut test, circle);
    // Member 1 paid rounds 0 and 1 (200_000) and receives the 800_000 pot.
    assert_eq!(
        account_balance(&mut test, &ctx.members[1]),
        Amount::new((INITIAL_BALANCE - 2 * CONTRIBUTION + 8 * CONTRIBUTION) as u128)
    );

    // Rounds 2 and 3: normal, recipients member 2 and member 3 get 400_000.
    for round in 2..4u32 {
        for member in &ctx.members {
            contribute_ok(&mut test, circle, member, round, CONTRIBUTION);
        }
        set_epoch(&mut test, ((round + 1) * 2) as u64);
        close_round_ok(&mut test, circle);
    }

    // Round 4: member 0 is the recipient again and is clear -> gets 400_000.
    for member in &ctx.members {
        contribute_ok(&mut test, circle, member, 4, CONTRIBUTION);
    }
    set_epoch(&mut test, 10);
    close_round_ok(&mut test, circle);
    // Member 0 paid: 4 rounds (1-4) + 100_000 arrears = 500_000 out,
    // received 400_000 in round 4.
    assert_eq!(
        account_balance(&mut test, &ctx.members[0]),
        Amount::new((INITIAL_BALANCE - 5 * CONTRIBUTION + 4 * CONTRIBUTION) as u128)
    );
}

#[test]
fn pay_arrears_wrong_amount_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;

    // Member 0 misses round 0 and owes 100_000.
    for member in &ctx.members[1..] {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, circle);

    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(ctx.members[0].account, "withdraw", args![TARI_TOKEN, CONTRIBUTION / 2])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "pay_arrears", args![Workspace("payment")])
            .build_and_seal(&ctx.members[0].secret),
        vec![ctx.members[0].proof.clone()],
    );
    assert_reject_reason(reason, "Payment must be exactly the amount owed");
}

#[test]
fn pay_arrears_no_arrears_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);

    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(ctx.members[0].account, "withdraw", args![TARI_TOKEN, CONTRIBUTION])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(ctx.circle, "pay_arrears", args![Workspace("payment")])
            .build_and_seal(&ctx.members[0].secret),
        vec![ctx.members[0].proof.clone()],
    );
    assert_reject_reason(reason, "Member has no arrears to pay");
}

#[test]
fn empty_vault_close() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;

    // Nobody pays round 0; closing still advances the round.
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, circle);

    // All four members are now in arrears; member 1 (round-1 recipient)
    // must clear arrears before their turn pays out.
    pay_arrears_ok(&mut test, circle, &ctx.members[1], CONTRIBUTION);
    for member in &ctx.members {
        contribute_ok(&mut test, circle, member, 1, CONTRIBUTION);
    }
    set_epoch(&mut test, 4);
    close_round_ok(&mut test, circle);
    // Member 1 is clear and gets the pot: 100_000 arrears + 400_000 round 1.
    // They paid 200_000 so far (round-0 arrears + round-1 contribution).
    assert_eq!(
        account_balance(&mut test, &ctx.members[1]),
        Amount::new((INITIAL_BALANCE - 2 * CONTRIBUTION + 5 * CONTRIBUTION) as u128)
    );
}

#[test]
fn anyone_can_close_round() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;

    for member in &ctx.members {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 2);

    // An outsider (not a member) closes the round.
    let (_, _, outsider_secret) = test.create_empty_account();
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "close_round", args![])
            .build_and_seal(&outsider_secret),
        vec![],
    );
    assert_eq!(
        account_balance(&mut test, &ctx.members[0]),
        Amount::new((INITIAL_BALANCE - CONTRIBUTION + 4 * CONTRIBUTION) as u128)
    );
}

#[test]
fn circle_finished_rejects_further_actions() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 2, 1, 1);
    let circle = ctx.circle;

    for member in &ctx.members {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 1);
    close_round_ok(&mut test, circle);

    // Contribute after finish.
    let reason = contribute_fail(&mut test, circle, &ctx.members[0], 1, CONTRIBUTION);
    assert_reject_reason(reason, "Circle is finished");

    // Close after finish.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "close_round", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert_reject_reason(reason, "Circle is finished");
}

#[test]
fn new_validates_inputs() {
    let mut test = TemplateTest::my_crate();
    let template = test.get_template_address(TEMPLATE_NAME);

    let (a1, _, _, pk1) = test.create_funded_account_with_keypair();
    let (a2, _, _, pk2) = test.create_funded_account_with_keypair();
    let p1 = pk1.to_byte_type();
    let p2 = pk2.to_byte_type();

    // 1 member: too few.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1],
                vec![a1],
                Amount::new(CONTRIBUTION as u128),
                4u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Arisan needs at least 2 members");

    // Duplicate member.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p1],
                vec![a1, a2],
                Amount::new(CONTRIBUTION as u128),
                4u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Duplicate member in circle");

    // Zero contribution.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p2],
                vec![a1, a2],
                Amount::new(0),
                4u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Contribution must be greater than zero");

    // Zero rounds.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p2],
                vec![a1, a2],
                Amount::new(CONTRIBUTION as u128),
                0u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Circle must run for at least 1 round");

    // Round length 0.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p2],
                vec![a1, a2],
                Amount::new(CONTRIBUTION as u128),
                4u32,
                0u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Round length must be between 1 and 1008 epochs");
}

#[test]
fn new_validates_more_inputs() {
    let mut test = TemplateTest::my_crate();
    let template = test.get_template_address(TEMPLATE_NAME);

    // 65 members: too many.
    let mut pubkeys = Vec::new();
    let mut accounts = Vec::new();
    for _ in 0..65 {
        let (a, _, _, pk) = test.create_funded_account_with_keypair();
        pubkeys.push(pk.to_byte_type());
        accounts.push(a);
    }
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                pubkeys,
                accounts,
                Amount::new(CONTRIBUTION as u128),
                4u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Arisan supports at most 64 members");

    let (a1, _, _, pk1) = test.create_funded_account_with_keypair();
    let (a2, _, _, pk2) = test.create_funded_account_with_keypair();
    let p1 = pk1.to_byte_type();
    let p2 = pk2.to_byte_type();

    // Round length 1009: too long.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p2],
                vec![a1, a2],
                Amount::new(CONTRIBUTION as u128),
                4u32,
                1009u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Round length must be between 1 and 1008 epochs");

    // Mismatched member vectors.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args![
                vec![p1, p2],
                vec![a1],
                Amount::new(CONTRIBUTION as u128),
                4u32,
                2u64
            ])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    assert_reject_reason(reason, "Member pubkeys and accounts must have the same length");
}

#[test]
fn pay_arrears_by_non_member_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 4, 4, 2);
    let circle = ctx.circle;
    // Round 0: everyone except member 0 pays, so member 0 falls into arrears.
    for member in &ctx.members[1..] {
        contribute_ok(&mut test, circle, member, 0, CONTRIBUTION);
    }
    set_epoch(&mut test, 2);
    close_round_ok(&mut test, circle);
    // An outsider tries to pay the arrears.
    let (outsider_account, outsider_proof, outsider_secret, _) =
        test.create_funded_account_with_keypair();
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(outsider_account, "withdraw", args![TARI_TOKEN, CONTRIBUTION])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "pay_arrears", args![Workspace("payment")])
            .build_and_seal(&outsider_secret),
        vec![outsider_proof],
    );
    assert_reject_reason(reason, "Only a circle member can pay arrears");
}

#[test]
fn pay_arrears_after_finish_rejected() {
    let mut test = TemplateTest::my_crate();
    let ctx = setup_circle(&mut test, 2, 1, 1);
    let circle = ctx.circle;
    // Round 0: member 1 pays, member 0 (recipient) does not -> arrears,
    // then closing finishes the 1-round circle.
    contribute_ok(&mut test, circle, &ctx.members[1], 0, CONTRIBUTION);
    set_epoch(&mut test, 1);
    close_round_ok(&mut test, circle);
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(ctx.members[0].account, "withdraw", args![TARI_TOKEN, CONTRIBUTION])
            .put_last_instruction_output_on_workspace("payment")
            .call_method(circle, "pay_arrears", args![Workspace("payment")])
            .build_and_seal(&ctx.members[0].secret),
        vec![ctx.members[0].proof.clone()],
    );
    assert_reject_reason(reason, "Circle is finished");
}
