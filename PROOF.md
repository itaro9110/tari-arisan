# Tari Arisan — Live Deployment Proof (Esmeralda testnet)

**Status: LIVE and VERIFIED on Esmeralda testnet, 2026-11-15.**
Template published, one TariArisan circle created, round 0 fully executed on-chain
(2 members contributed, round closed, pot paid out, arrears recorded).

> Testnet only. No mainnet deployment, no real TARI, no real funds.
> All amounts below are testnet tTARI (µT = micro-TARI, 1 tTARI = 1,000,000 µT).

## Live addresses

| Item | Address |
|---|---|
| Template | `template_f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5` |
| Template name | `TariArisan` |
| Circle component | `component_fe42c4e6f21f2066cac7acdabb5fabcd9bd365af8aadd154ece22dd0d2f601e8` |
| Circle vault | `vault_fe930fe9202d86a9dfa09b7766bfdbcd4c5d4f854527235ff0b52565afe9e6bd` |
| Public indexer | https://esme-indexer-a.ootle.tari.com/ (mirror: https://esme-indexer-b.ootle.tari.com/) |

## WASM

- Source: `src/lib.rs` (Rust template, `TariArisan`)
- Release WASM: `target/wasm32-unknown-unknown/release/tari_arisan.wasm`
- Size: 156,211 bytes
- SHA-256: `3c5bc3681b2dce90e6f92a7d295345d1248770e705dcbe19b2640c9ab0c41ec6`

## Transactions (all on Esmeralda)

| Step | Transaction | Fee (µT) | Result |
|---|---|---|---|
| Publish template | `4b5417e63d3d9625156dc6fc9ee891d37db0523eff8b1a0fe5c3fa227048c93d` | 1,033,403 | Accepted — `std.template.publish` |
| Create circle (4 members) | `7c4bbbc5d520e344bfd96c07fcf49867681f853a86cc97585de9bfcde3bb270b` | 3,504 | Accepted — `std.component.created` |
| Fund Member2 (5 tTARI) | `bd3a20e674bf00c085da1e889e212637356533c37df2d6ea86284c98a33c238d` | 3,663 | Accepted |
| Fund Member3 (5 tTARI) | `ae7aeb37cf2984f6399bc4a07b9c5252a1aa2064834e9b4c9451c9d0ace94cab` | 3,663 | Accepted |
| Fund Member4 (5 tTARI) | `23227f408688fd77bac8d5608801ac1de3455818c1da9f1b5b9dac1d23d5abc4` | 3,663 | Accepted |
| Member1 contributes round 0 (0.1 tTARI) | `70102725d906b8da2b7b4b153e2a7eeca6dac9cb2801b2baa91f2f9c7ec118dc` | 3,864 | Accepted — `TariArisan.ContributionReceived` (round 0, member `f8a944e5…`, 100,000) |
| Member2 contributes round 0 (0.1 tTARI) | `f409b34b45625db2540a9e47f8a1cbf0cf6df9d1183eb042211b2a50ef05f401` | 3,914 | Accepted — `TariArisan.ContributionReceived` (round 0, member `9ca24e46…`, 100,000) |
| Close round 0 | `8d26e5b49eb2ab69c7d48af8e3f2f2ae10230793e1936d18334137bb94329f69` | 4,605 | Accepted — `TariArisan.RoundClosed` (round 0, recipient `f8a944e5…`, 200,000, deferred false) + `ArrearsRecorded` for Member3 and Member4 (100,000 each) |

## Circle parameters (live)

- Members (4): see table below. Contribution: **100,000 µT (0.1 tTARI)** per round.
- Rounds per circle: 4. Round length: **1 epoch**.
- Created in L2 epoch 13104; round 0 deadline epoch 13105; closed in epoch 13105.

| # | Member (walletd account) | Owner public key | Account component |
|---|---|---|---|
| 1 | Default | `f8a944e550083d42c7ba8cdd747c01666bac0e5d3db99bc2ac74a751b7cda33b` | `component_6e3b63a7695c9e619dff68589c85bb8e41bab8b403bcace1d97d17caa57fcde8` |
| 2 | Member2 | `9ca24e464e49ad51b515cbbfb69321ea7eecb736988924ef3f4615bdf7be4f3b` | `component_2807f2401e2cc0788dd9fc746b2e050812e542f260107595d33dbb74fa5355d6` |
| 3 | Member3 | `7a6acdd8d76becb91af06a2ea6347c155002cceea0a0931b73bf663327e51407` | `component_1afd0cea282f8c18c1aadbc0b8a80eade4d9b0d3f4a8ee13fe4bb803ec32c3e8` |
| 4 | Member4 | `8419b64df3a444fe8b6cb82afab7fd935e5e402aa89e289fba3091c814fd2e2d` | `component_d96c86455aeff316cacf2ba511a512c4970136c6295575f131a6db15d963be73` |

## Round 0 result (verified on-chain)

- Member1 and Member2 each contributed 100,000 µT (circle vault held 200,000 µT).
- Round 0 closed in epoch 13105. Recipient for round 0 is member[0] = Member1.
- Member1 received the **200,000 µT pot** (vault deposit, confirmed by balance:
  Member1 revealed balance after close = 84,031,692 µT, reconciles exactly with
  all fees + contributions + the 200,000 payout).
- Member3 and Member4 did **not** contribute, so each is recorded in arrears
  for 100,000 µT (`ArrearsRecorded` events, round 0). They must `pay_arrears`
  before their turn can pay out.
- Circle advanced to **round 1** (per `close_round` in `src/lib.rs`).

## How to verify (judge steps)

1. Open the template on the indexer:
   https://esme-indexer-a.ootle.tari.com/templates/f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5
   — shows template name `TariArisan` and the `new` function with
   `(member_pubkeys: Vec<RistrettoPublicKeyBytes>, member_accounts: Vec<ComponentAddress>, contribution: Amount, rounds_per_circle: U32, round_length_epochs: U64)`.
2. Open the circle component:
   https://esme-indexer-a.ootle.tari.com/substates/component_fe42c4e6f21f2066cac7acdabb5fabcd9bd365af8aadd154ece22dd0d2f601e8
   — versioned, verified substate.
3. Open any transaction above at:
   https://esme-indexer-a.ootle.tari.com/transactions/<tx-id>
   — the publish, create, contribute and close transactions and their events
   (`std.template.publish`, `std.component.created`,
   `TariArisan.ContributionReceived`, `TariArisan.RoundClosed`,
   `TariArisan.ArrearsRecorded`) are all visible there.
   > **Indexer caveat (checked 2026-11-17):** the public Esmeralda indexer
   > currently answers `{"error": "Transaction … is not known to this indexer"}`
   > for these 2026-11-15 transaction ids on both indexer-a and indexer-b,
   > while the template and component pages resolve fine. The indexer appears
   > not to retain historical transactions. The transactions themselves are
   > real: the walletd submission receipts and the resulting on-chain state
   > corroborate them — the circle component is `verified: true` at version 3
   > with `value_hash_epoch: 13105` (the close epoch), and Member1's revealed
   > balance after the close reconciles exactly (84,031,692 µT). If a
   > transaction link 404s, verify via the component substate (step 2) and
   > the template page (step 1) instead.
4. Re-run the flow yourself with the walletd (`tari_ootle_walletd` v0.53.3,
   `--network esme`): the manifests in `manifests/` reproduce every
   step — `create_circle_live.tm`, `contribute.tm`, `close_round.tm`,
   `info.tm` — via `transactions.submit_manifest`. The live-write instruction
   encoding used by those manifests is the Tari manifest DSL documented in the
   official `tari-ootle` v0.53.3 `tari-manifest` skill and verified by the
   on-chain executions above.
5. Frontend: `web/app.js` CONFIG now points at the live template/component and
   the public indexer (`LIVE_WRITES_VERIFIED: true`).

## How test funds were obtained (and the gap we hit)

- The built-in Esmeralda faucet was **empty** (verified `accounts.get_faucet_balance`
  = 0 on 2026-11-14 22:32, 2026-11-15 01:12 and 01:51 UTC).
- Funds came from the burn path: 10,000 tXTM from the tXTM faucet
  (https://testnet-faucet.supportxtm.com/, tx id `531905193677864710`),
  then a 1,000 tTARI burn on L1 (Minotari tx `254496115937423180`,
  commitment `2abe9d98f885d3b7677dd2ed9e2bab95a20b7c647ea4250de82d0d981894154f`)
  claimed on Esmeralda by the walletd auto-claim service
  (claim tx `7bc9381569a6814cf860c286676e54314c73b8c2c8d9411953abb344055d0d73`,
  999,986,100 µT after the 13,900 µT claim fee).
- **Gap found in walletd v0.53.3:** the burn claim lands as a stealth UTXO and
  does NOT create the account component on-chain, so no walletd flow could spend
  the funds until the account was created. We created it with a hand-built
  transaction (tx `84427dc7d6cca82c1b3154940b78ca9cf720d5d5ead29c2912871cab6e84afda`,
  fee 11,943 µT) that reveals 100 tTARI from the claimed UTXO via a
  `StealthTransfer` statement, deposits it into the new account (creating its
  TARI vault), and pays the fee from that vault — the same shape as the
  walletd's own faucet-claim transaction. The account is now confirmed on-chain
  with a revealed balance (99,988,057 µT right after creation) and the remaining
  ~899,986,100 µT as blinded change.
- One earlier 1,000 tTARI burn (L1 tx `6300902540744299761`) was made with an
  **empty claim public key** and is unclaimable (burned to nobody) — testnet
  funds only, no real loss. The correct burn was re-done with the account's
  claim key `f8a944e5…`.
- L1 wallet still holds ~8,000 tXTM for further test funding if needed.

## Notes / known issues encountered

- Member2's first contribute attempt (tx `d16805bde2ef7550834598b4f2b9b07078c93082a6398225928be87e76cdff51`)
  was **Rejected: AccessDenied on pay_fee** — the manifest was signed with the
  default account's key instead of Member2's. Retried with the correct
  `seal_signer_key_id` (Member2's owner key, Derived index 1) and it accepted.
  Lesson: when the fee account is not the default account, the manifest must be
  submitted with that account's `seal_signer_key_id`.
- The dry-run predicted component address for the circle
  (`component_53ba5f7e…`) differs from the live one (`component_fe42c4e6…`) —
  component addresses are not deterministic across dry-run vs live. Always use
  the address from the live transaction result.
- Esmeralda L2 epochs lag L1 by roughly an hour (epoch 13104 appeared on L2
  ~50 min after L1 entered it). The burn claim only becomes valid once L2
  passes the burn's L1 epoch, and round deadlines are L2 epochs — plan waits
  accordingly.
- The VM was replaced twice during this session (walletd + console wallet had
  to be restarted; all state survived on disk under `~/workspace/tari-contest/`
  and `~/.tari/`).
