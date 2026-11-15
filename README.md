# Tari Arisan

A rotating savings circle (*arisan*) enforced by a [Tari Ootle](https://ootle.tari.com/)
smart contract. Built for the **Tari November Build Contest** (theme: MVP).

Arisan is the rotating savings circle used by millions of people in Indonesia
and across Southeast Asia: a fixed group chips in a fixed amount every round,
and each round one member takes the whole pot, until everyone has had a turn.
No interest, no bank, no platform cut — just a social contract. Tari Arisan
puts that social contract on-chain: the contract holds the money and enforces
the rotation, so no treasurer can run off with the pot.

> **Status:** Phase 3 DONE — **LIVE on Esmeralda testnet, verified 2026-11-15.**
> Template `template_f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5`
> published; one ArisanCircle `component_fe42c4e6f21f2066cac7acdabb5fabcd9bd365af8aadd154ece22dd0d2f601e8`
> created; round 0 executed on-chain (2 members contributed 0.1 tTARI each,
> round closed, 0.2 tTARI pot paid to member 1, members 3–4 in arrears).
> Full proof: [`PROOF.md`](PROOF.md). No mainnet deployment yet.

## Frontend (`web/`)

A single static site (plain HTML/CSS/JS, no build step, hostable on
GitHub Pages). Two modes:

- **Simulation (default)** — a 4-member demo circle (Ayu, Budi, Citra,
  Dewi; 0.1 TARI per round, 4 rounds, 2 epochs per round) running the
  exact contract rules in-browser via `web/arisan-sim.js`, a pure-JS
  mirror of `src/lib.rs` (same state, methods, and panic messages).
  Includes the member list with paid/unpaid status, round countdown,
  vault balance, Contribute / Close round / Pay arrears buttons, an
  arrears banner, round history, an epoch clock (auto-tick every 15 s,
  or advance manually — a full circle takes ~2 minutes), a one-click
  full-circle auto-play, a missed-payment demo, and three deliberate
  rejection demos (wrong amount, non-member, early close). The UI says
  plainly that this is a simulation of the on-chain rules.
- **Live — Esmeralda testnet** — connects through the Sapient / Tari
  Universe provider (`window.tari`; methods verified from
  `universe.tari.mw/integration`). Reads a live circle via
  `tari_getSubstate`. **Live writes are verified**: `web/app.js` `CONFIG`
  now points at the live template/component and the public Esmeralda indexer
  (`LIVE_WRITES_VERIFIED: true`) — the instruction encoding was confirmed by
  real on-chain transactions (contribute + close_round, see [`PROOF.md`](PROOF.md)).
  The page never fakes a live transaction.

Run it locally:

```sh
cd web
python3 -m http.server 8000   # then open http://localhost:8000
```

Test it (no browser needed — the simulation engine and the UI wiring
are both tested in node against a stub DOM):

```sh
cd web
node test-sim.js   # 17 tests, mirrors tests/test.rs case-for-case
node test-ui.js    # 11 UI smoke tests (handlers, demos, live gating)
```

## How it works

One `TariArisan` component per circle:

- **Members** — a fixed list, in payout order. Round `r` pays
  `members[r % members.len()]`. Each member is identified by their signing
  key, and payouts go to their account component.
- **Contribution** — a fixed amount of TARI (µT) every member owes each round.
- **Rounds** — the circle runs for a fixed number of rounds; each round lasts
  a fixed number of Ootle epochs (mainnet ~20 min, Esmeralda testnet ~1 h).
- **The pot** — every contribution and arrears payment lands in the
  component's TARI vault. The contract never takes a cut.

### Methods

| Method | Who | What it does |
|---|---|---|
| `new(pubkeys, accounts, contribution, rounds, round_length_epochs)` | anyone | Creates a circle. 2–64 members, contribution > 0, ≥ 1 round, round length 1–1008 epochs, no duplicate members. |
| `contribute(round, payment)` | a member | Deposits exactly `contribution` TARI for the current round. |
| `close_round()` | anyone | Closes the current round once its deadline epoch is reached; pays the pot to the round's recipient. |
| `pay_arrears(payment)` | a member in arrears | Clears the member's full arrears with one exact payment. |
| `info()` | anyone | Read-only snapshot of the circle (members, round, deadline, vault balance, …). |

### The rules (v1)

1. **Exact payment only.** `contribute` accepts exactly the contribution
   amount, only for the current round, only once per (round, member), and
   only from a member. Anything else panics and the transaction changes
   nothing.
2. **Miss a payment, fall into arrears.** When a round closes, every member
   who did not pay that round gets `arrears += contribution`.
3. **Miss your turn, miss the pot.** If the round's recipient is in arrears
   at close time, no payout happens: the pot stays in the vault and rolls
   over to the next round's recipient (a bigger pot). The deferred member
   can restore standing with `pay_arrears` before their next turn comes
   around — but a missed turn is never paid out later.
4. **Anyone can close a round.** Once the deadline epoch is reached, any
   account may call `close_round` — the circle never stalls because the
   recipient is offline.
5. **Nobody can rug it.** There are no owner or admin methods. Every
   mutating method is `allow_all` and membership is enforced in code; the
   template can never be upgraded (`UpdateRule::Locked`). The creator has
   no special powers — their key is recorded only for transparency.
6. **Empty rounds still close.** If nobody paid, closing just advances the
   round (and everyone falls into arrears). The circle keeps moving.

### Events

The template emits `ContributionReceived`, `ArrearsRecorded`,
`ArrearsPaid`, and `RoundClosed` (with a `deferred` flag) so indexers and
the frontend can follow a circle without polling state.

## Build & test

Prerequisites: Rust (stable) + the `wasm32-unknown-unknown` target.

```sh
rustup target add wasm32-unknown-unknown

# Run the engine tests (real Ootle execution engine, in-process; no
# network, no funds needed):
cargo test

# Build the WASM template (release profile is tuned for size; the binary
# is capped at 1 MiB on-chain and the publish fee rises above 96 KiB):
cargo build-wasm
```

## Project layout

- `src/lib.rs` — the `TariArisan` template.
- `tests/test.rs` — 16 engine tests: full-circle happy path, every
  rejection (wrong amount, non-member, wrong round, double pay, early
  close, arrears rules), empty-vault close, anyone-can-close, finished
  circle, and constructor validation.
- `web/` — static frontend: `index.html`, `style.css`,
  `arisan-sim.js` (pure simulation engine, no DOM), `app.js` (UI wiring
  + live mode), `test-sim.js` (17 node tests mirroring `tests/test.rs`),
  `test-ui.js` (11 node UI smoke tests).
- `LICENSE` — MIT.

## Known limitations (v1)

- Arrears must be cleared in full with one exact payment; no partial
  payments.
- Paid history for past rounds is kept in state (never pruned).
- Round length is fixed at creation; members cannot be added or removed
  after creation.

## License

MIT — see `LICENSE`.
