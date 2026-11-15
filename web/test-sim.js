// Tari Arisan — simulation tests (node).
//
// SPDX-License-Identifier: MIT
//
// Mirrors tests/test.rs case-for-case against the JS simulation engine
// (arisan-sim.js), so the frontend's rules are proven identical to the
// on-chain contract's rules. Run: `node test-sim.js` (exit 0 = all pass).

"use strict";

var sim = require("./arisan-sim.js");
var ArisanSim = sim.ArisanSim;
var CONTRIBUTION = sim.CONTRIBUTION_DEFAULT; // 100_000 µT = 0.1 TARI
var INITIAL_BALANCE = sim.INITIAL_BALANCE; // 1_000_000_000 µT

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    failures.push(name + ": " + e.message);
    console.log("FAIL  " + name + " — " + e.message);
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || "value") + ": expected " + expected + ", got " + actual);
  }
}

function throws(fn, message, what) {
  try {
    fn();
  } catch (e) {
    if (e.message !== message) {
      throw new Error((what || "error") + ": expected \"" + message + "\", got \"" + e.message + "\"");
    }
    return;
  }
  throw new Error((what || "error") + ": expected throw \"" + message + "\", but nothing threw");
}

function demoMembers() {
  return [
    { name: "Ayu", pubkey: "ayu", account: "account-ayu" },
    { name: "Budi", pubkey: "budi", account: "account-budi" },
    { name: "Citra", pubkey: "citra", account: "account-citra" },
    { name: "Dewi", pubkey: "dewi", account: "account-dewi" },
  ];
}

function setup(n, rounds, roundLength) {
  var s = new ArisanSim({
    members: demoMembers().slice(0, n || 4),
    contribution: CONTRIBUTION,
    rounds: rounds == null ? 4 : rounds,
    roundLength: roundLength == null ? 2 : roundLength,
  });
  return s;
}

function payAll(s, round) {
  demoMembers().forEach(function (m) {
    s.contribute({ member: m.pubkey, round: round, amount: CONTRIBUTION });
  });
}

function closeAtDeadline(s, round) {
  s.advanceEpoch(s.info().roundDeadlineEpoch - s.info().currentEpoch);
  return s.closeRound({ caller: "anyone" });
}

console.log("Tari Arisan simulation tests — mirroring tests/test.rs");

test("circle_creation_sets_initial_state", function () {
  var s = setup();
  s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION });
  throws(function () {
    s.contribute({ member: "budi", round: 1, amount: CONTRIBUTION });
  }, "Can only contribute to the current round");
});

test("full_circle_happy_path", function () {
  var s = setup();
  for (var round = 0; round < 4; round++) {
    payAll(s, round);
    var result = closeAtDeadline(s, round);
    eq(result.deferred, false, "round " + round + " deferred");
    eq(result.amount, 4 * CONTRIBUTION, "round " + round + " pot");
  }
  eq(s.isFinished(), true, "finished");
  throws(function () { s.closeRound({}); }, "Circle is finished");
  demoMembers().forEach(function (m) {
    eq(s.memberByPubkey(m.pubkey).balance, INITIAL_BALANCE, m.name + " balance");
  });
});

test("wrong_amount_rejected", function () {
  var s = setup();
  throws(function () {
    s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION - 1 });
  }, "Payment must be exactly the contribution amount");
  throws(function () {
    s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION + 1 });
  }, "Payment must be exactly the contribution amount");
});

test("zero_amount_rejected", function () {
  var s = setup();
  throws(function () {
    s.contribute({ member: "ayu", round: 0, amount: 0 });
  }, "Payment must be exactly the contribution amount");
});

test("non_member_rejected", function () {
  var s = setup();
  throws(function () {
    s.contribute({ member: "rudi-outsider", round: 0, amount: CONTRIBUTION });
  }, "Only a circle member can contribute");
});

test("wrong_round_rejected", function () {
  var s = setup();
  throws(function () {
    s.contribute({ member: "ayu", round: 1, amount: CONTRIBUTION });
  }, "Can only contribute to the current round");
});

test("double_pay_rejected", function () {
  var s = setup();
  s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION });
  throws(function () {
    s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION });
  }, "Member already paid this round");
});

test("early_close_rejected", function () {
  var s = setup();
  throws(function () { s.closeRound({}); }, "Round cannot be closed before its deadline epoch");
  s.advanceEpoch(2); // exactly at the deadline
  s.closeRound({});
  throws(function () {
    s.contribute({ member: "ayu", round: 0, amount: CONTRIBUTION });
  }, "Can only contribute to the current round");
});

test("arrears_recorded_and_turn_deferred", function () {
  var s = setup();
  // Round 0 recipient is Ayu. Everyone except Ayu pays.
  ["budi", "citra", "dewi"].forEach(function (pk) {
    s.contribute({ member: pk, round: 0, amount: CONTRIBUTION });
  });
  var result = closeAtDeadline(s, 0);
  eq(result.deferred, true, "round 0 deferred");
  eq(result.amount, 0, "round 0 payout");
  eq(s.memberByPubkey("ayu").balance, INITIAL_BALANCE, "Ayu received nothing");
  eq(s.arrearsOf("ayu"), CONTRIBUTION, "Ayu arrears");
  eq(s.vault, 3 * CONTRIBUTION, "vault keeps the pot");
  // Round 1 is open: Budi can contribute to it.
  s.contribute({ member: "budi", round: 1, amount: CONTRIBUTION });
});

test("arrears_payoff_restores_turn", function () {
  var s = setup(4, 5, 2); // 5 rounds so Ayu gets a turn again in round 4
  ["budi", "citra", "dewi"].forEach(function (pk) {
    s.contribute({ member: pk, round: 0, amount: CONTRIBUTION });
  });
  closeAtDeadline(s, 0);
  // Ayu clears the 100_000 arrears (vault now holds 400_000).
  s.payArrears({ member: "ayu", amount: CONTRIBUTION });
  eq(s.arrearsOf("ayu"), 0, "Ayu arrears cleared");
  eq(s.vault, 4 * CONTRIBUTION, "vault after arrears payoff");
  // Round 1: everyone pays -> vault 800_000, Budi gets it.
  payAll(s, 1);
  var r1 = closeAtDeadline(s, 1);
  eq(r1.deferred, false, "round 1 not deferred");
  eq(r1.amount, 8 * CONTRIBUTION, "round 1 pot (rollover + arrears + contributions)");
  eq(s.memberByPubkey("budi").balance, INITIAL_BALANCE - 2 * CONTRIBUTION + 8 * CONTRIBUTION, "Budi balance");
  // Rounds 2 and 3: normal.
  for (var round = 2; round < 4; round++) {
    payAll(s, round);
    closeAtDeadline(s, round);
  }
  // Round 4: Ayu is the recipient again and is clear -> gets 400_000.
  payAll(s, 4);
  closeAtDeadline(s, 4);
  eq(s.memberByPubkey("ayu").balance, INITIAL_BALANCE - 5 * CONTRIBUTION + 4 * CONTRIBUTION, "Ayu balance");
});

test("pay_arrears_wrong_amount_rejected", function () {
  var s = setup();
  ["budi", "citra", "dewi"].forEach(function (pk) {
    s.contribute({ member: pk, round: 0, amount: CONTRIBUTION });
  });
  closeAtDeadline(s, 0);
  throws(function () {
    s.payArrears({ member: "ayu", amount: CONTRIBUTION / 2 });
  }, "Payment must be exactly the amount owed");
});

test("pay_arrears_no_arrears_rejected", function () {
  var s = setup();
  throws(function () {
    s.payArrears({ member: "ayu", amount: CONTRIBUTION });
  }, "Member has no arrears to pay");
});

test("empty_vault_close", function () {
  var s = setup();
  // Nobody pays round 0; closing still advances the round.
  var r0 = closeAtDeadline(s, 0);
  eq(r0.deferred, true, "empty round deferred");
  eq(s.vault, 0, "vault empty");
  // Budi (round-1 recipient) clears arrears, everyone pays round 1.
  s.payArrears({ member: "budi", amount: CONTRIBUTION });
  payAll(s, 1);
  var r1 = closeAtDeadline(s, 1);
  eq(r1.deferred, false, "round 1 not deferred");
  eq(r1.amount, 5 * CONTRIBUTION, "round 1 pot (arrears + contributions)");
  eq(s.memberByPubkey("budi").balance, INITIAL_BALANCE - 2 * CONTRIBUTION + 5 * CONTRIBUTION, "Budi balance");
});

test("anyone_can_close_round", function () {
  var s = setup();
  payAll(s, 0);
  s.advanceEpoch(2);
  // An outsider (not a member) closes the round.
  s.closeRound({ caller: "rudi-outsider" });
  eq(s.memberByPubkey("ayu").balance, INITIAL_BALANCE - CONTRIBUTION + 4 * CONTRIBUTION, "Ayu balance");
});

test("circle_finished_rejects_further_actions", function () {
  var s = setup(2, 1, 1);
  ["ayu", "budi"].forEach(function (pk) {
    s.contribute({ member: pk, round: 0, amount: CONTRIBUTION });
  });
  s.advanceEpoch(1);
  s.closeRound({});
  throws(function () {
    s.contribute({ member: "ayu", round: 1, amount: CONTRIBUTION });
  }, "Circle is finished");
  throws(function () { s.closeRound({}); }, "Circle is finished");
});

test("new_validates_inputs", function () {
  throws(function () {
    new ArisanSim({ members: demoMembers().slice(0, 1), contribution: CONTRIBUTION, rounds: 4, roundLength: 2 });
  }, "Arisan needs at least 2 members");
  throws(function () {
    new ArisanSim({ members: [demoMembers()[0], demoMembers()[0]], contribution: CONTRIBUTION, rounds: 4, roundLength: 2 });
  }, "Duplicate member in circle");
  throws(function () {
    new ArisanSim({ members: demoMembers(), contribution: 0, rounds: 4, roundLength: 2 });
  }, "Contribution must be greater than zero");
  throws(function () {
    new ArisanSim({ members: demoMembers(), contribution: CONTRIBUTION, rounds: 0, roundLength: 2 });
  }, "Circle must run for at least 1 round");
  throws(function () {
    new ArisanSim({ members: demoMembers(), contribution: CONTRIBUTION, rounds: 4, roundLength: 0 });
  }, "Round length must be between 1 and 1008 epochs");
});

test("format_helpers", function () {
  eq(sim.formatTari(100000), "0.1 TARI", "0.1 TARI");
  eq(sim.formatTari(1000000000), "1,000 TARI", "1,000 TARI");
  eq(sim.formatTari(400000), "0.4 TARI", "0.4 TARI");
  eq(sim.formatMicro(100000), "100,000 µT", "micro format");
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) {
  console.log("Failures:\n- " + failures.join("\n- "));
  process.exit(1);
}
