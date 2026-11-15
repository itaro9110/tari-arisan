// Tari Arisan — walletless simulation engine.
//
// SPDX-License-Identifier: MIT
//
// A pure-JS mirror of the on-chain `TariArisan` template
// (../src/lib.rs). Same state, same methods, same rules, same panic
// messages — so anything the simulation shows, the contract enforces.
// No DOM, no network, no wallet: this file runs in the browser AND in
// node (UMD export) so the simulation can be tested against the same
// cases as the Rust engine tests (see test-sim.js).
//
// Units: micro-TARI (µT). 1 TARI = 1,000,000 µT.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.ArisanSim = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CONTRIBUTION_DEFAULT = 100000; // µT = 0.1 TARI per round per member
  var INITIAL_BALANCE = 1000000000; // µT = 1,000 TARI per member (as in tests/test.rs)
  var MAX_MEMBERS = 64;
  var MIN_MEMBERS = 2;
  var MAX_ROUND_LENGTH = 1008;

  function formatTari(microTari) {
    // 100000 -> "0.1 TARI"; 1000000000 -> "1,000 TARI"
    var whole = Math.floor(microTari / 1000000);
    var frac = microTari % 1000000;
    var wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac === 0) return wholeStr + " TARI";
    var fracStr = String(frac).padStart(6, "0").replace(/0+$/, "");
    return wholeStr + "." + fracStr + " TARI";
  }

  function formatMicro(microTari) {
    return String(microTari).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " µT";
  }

  // ------------------------------------------------------------------
  // ArisanSim — one circle.
  //
  // members: [{ name, pubkey, account }] — pubkey/account are display
  //   strings in the simulation (in the contract they are a Ristretto
  //   public key and a component address).
  // contribution: µT per member per round.
  // rounds: total number of rounds the circle runs for.
  // roundLength: length of one round, in (simulated) epochs.
  // startEpoch: epoch the circle starts at (default 0).
  // ------------------------------------------------------------------
  function ArisanSim(opts) {
    opts = opts || {};
    var members = opts.members || [];
    var contribution = opts.contribution == null ? CONTRIBUTION_DEFAULT : opts.contribution;
    var rounds = opts.rounds == null ? 4 : opts.rounds;
    var roundLength = opts.roundLength == null ? 2 : opts.roundLength;

    // Constructor validation — same checks, same messages as `new` in lib.rs.
    if (members.length < MIN_MEMBERS) throw new Error("Arisan needs at least 2 members");
    if (members.length > MAX_MEMBERS) throw new Error("Arisan supports at most 64 members");
    if (!(contribution > 0)) throw new Error("Contribution must be greater than zero");
    if (!(rounds > 0)) throw new Error("Circle must run for at least 1 round");
    if (!(roundLength >= 1 && roundLength <= MAX_ROUND_LENGTH)) {
      throw new Error("Round length must be between 1 and 1008 epochs");
    }
    var seen = {};
    members.forEach(function (m) {
      if (seen[m.pubkey]) throw new Error("Duplicate member in circle");
      seen[m.pubkey] = true;
    });

    this.members = members.map(function (m) {
      return {
        name: m.name,
        pubkey: m.pubkey,
        account: m.account,
        balance: opts.initialBalance == null ? INITIAL_BALANCE : opts.initialBalance,
        received: 0,
      };
    });
    this.contribution = contribution;
    this.roundsPerCircle = rounds;
    this.roundLengthEpochs = roundLength;
    this.round = 0;
    this.currentEpoch = opts.startEpoch || 0;
    this.roundDeadlineEpoch = this.currentEpoch + roundLength;
    this.paid = {}; // "round:pubkey" -> true
    this.arrears = {}; // pubkey -> µT owed
    this.vault = 0; // µT
    this.creator = opts.creator || members[0].pubkey;
    this.events = []; // chronological log for the UI
    this._log("CircleCreated", 0, null, 0, "Circle created: " + members.length + " members, " +
      formatTari(contribution) + " per round, " + rounds + " rounds");
  }

  ArisanSim.prototype._log = function (type, round, member, amount, message) {
    this.events.push({
      type: type,
      round: round,
      member: member,
      amount: amount,
      epoch: this.currentEpoch,
      message: message,
    });
  };

  ArisanSim.prototype.isFinished = function () {
    return this.round >= this.roundsPerCircle;
  };

  ArisanSim.prototype.isMember = function (pubkey) {
    return this.members.some(function (m) { return m.pubkey === pubkey; });
  };

  ArisanSim.prototype.memberByPubkey = function (pubkey) {
    for (var i = 0; i < this.members.length; i++) {
      if (this.members[i].pubkey === pubkey) return this.members[i];
    }
    return null;
  };

  ArisanSim.prototype.recipientIndex = function (round) {
    return round % this.members.length;
  };

  ArisanSim.prototype.recipientFor = function (round) {
    return this.members[this.recipientIndex(round)];
  };

  ArisanSim.prototype.paidThisRound = function (pubkey) {
    return !!this.paid[this.round + ":" + pubkey];
  };

  ArisanSim.prototype.arrearsOf = function (pubkey) {
    return this.arrears[pubkey] || 0;
  };

  // Contribute exactly `contribution` to the current round.
  // Checks run in the same order as lib.rs `contribute`.
  ArisanSim.prototype.contribute = function (opts) {
    var member = this.memberByPubkey(opts.member);
    if (this.isFinished()) throw new Error("Circle is finished");
    if (opts.round !== this.round) throw new Error("Can only contribute to the current round");
    if (!member) throw new Error("Only a circle member can contribute");
    if (opts.amount !== this.contribution) {
      throw new Error("Payment must be exactly the contribution amount");
    }
    if (this.paid[this.round + ":" + opts.member]) {
      throw new Error("Member already paid this round");
    }
    if (member.balance < opts.amount) throw new Error("Insufficient balance (simulation)");
    member.balance -= opts.amount;
    this.vault += opts.amount;
    this.paid[this.round + ":" + opts.member] = true;
    this._log("ContributionReceived", this.round, member.name, opts.amount,
      member.name + " paid " + formatTari(opts.amount) + " for round " + (this.round + 1));
    return true;
  };

  // Close the current round. Callable by anyone (even a non-member) once
  // the deadline epoch is reached. Same rules as lib.rs `close_round`.
  ArisanSim.prototype.closeRound = function (opts) {
    opts = opts || {};
    if (this.isFinished()) throw new Error("Circle is finished");
    if (this.currentEpoch < this.roundDeadlineEpoch) {
      throw new Error("Round cannot be closed before its deadline epoch");
    }
    var round = this.round;
    var self = this;
    // Everyone who did not pay this round falls into arrears.
    this.members.forEach(function (m) {
      if (!self.paid[round + ":" + m.pubkey]) {
        self.arrears[m.pubkey] = (self.arrears[m.pubkey] || 0) + self.contribution;
        self._log("ArrearsRecorded", round, m.name, self.contribution,
          m.name + " missed round " + (round + 1) + " — arrears +" + formatTari(self.contribution));
      }
    });
    var recipient = this.recipientFor(round);
    var recipientArrears = this.arrearsOf(recipient.pubkey);
    var pot = this.vault;
    var deferred = true;
    if (recipientArrears === 0 && pot > 0) {
      this.vault = 0;
      recipient.balance += pot;
      recipient.received += pot;
      deferred = false;
      this._log("RoundClosed", round, recipient.name, pot,
        "Round " + (round + 1) + " closed — " + recipient.name + " receives the pot of " + formatTari(pot));
    } else {
      this._log("RoundClosed", round, recipient.name, 0,
        "Round " + (round + 1) + " closed — payout DEFERRED (" + recipient.name +
        (recipientArrears > 0 ? " is in arrears, owes " + formatTari(recipientArrears) : "pot is empty") +
        "). Pot of " + formatTari(pot) + " rolls over.");
    }
    this.round += 1;
    this.roundDeadlineEpoch += this.roundLengthEpochs;
    return { round: round, recipient: recipient.name, amount: deferred ? 0 : pot, deferred: deferred };
  };

  // Clear a member's full arrears with one exact payment.
  // Same checks, same order as lib.rs `pay_arrears`.
  ArisanSim.prototype.payArrears = function (opts) {
    var member = this.memberByPubkey(opts.member);
    if (this.isFinished()) throw new Error("Circle is finished");
    if (!member) throw new Error("Only a circle member can pay arrears");
    var owed = this.arrearsOf(opts.member);
    if (owed === 0) throw new Error("Member has no arrears to pay");
    if (opts.amount !== owed) throw new Error("Payment must be exactly the amount owed");
    if (member.balance < opts.amount) throw new Error("Insufficient balance (simulation)");
    member.balance -= opts.amount;
    this.vault += opts.amount;
    delete this.arrears[opts.member];
    this._log("ArrearsPaid", this.round, member.name, opts.amount,
      member.name + " cleared arrears of " + formatTari(opts.amount) + " — standing restored");
    return true;
  };

  // Simulation-only helper: move time forward. On-chain this is the
  // Ootle epoch advancing (mainnet ~20 min, Esmeralda ~1 h); here an
  // epoch is a short tick so a judge can run a whole circle in ~2 minutes.
  ArisanSim.prototype.advanceEpoch = function (n) {
    this.currentEpoch += (n == null ? 1 : n);
    return this.currentEpoch;
  };

  // Public read-only snapshot — mirrors `info()` in lib.rs.
  ArisanSim.prototype.info = function () {
    return {
      members: this.members.map(function (m) { return m.pubkey; }),
      contribution: this.contribution,
      roundsPerCircle: this.roundsPerCircle,
      roundLengthEpochs: this.roundLengthEpochs,
      round: this.round,
      roundDeadlineEpoch: this.roundDeadlineEpoch,
      currentEpoch: this.currentEpoch,
      isFinished: this.isFinished(),
      vaultBalance: this.vault,
      creator: this.creator,
    };
  };

  // Everything the dashboard needs for one member.
  ArisanSim.prototype.memberState = function (pubkey) {
    var m = this.memberByPubkey(pubkey);
    if (!m) return null;
    return {
      name: m.name,
      pubkey: m.pubkey,
      account: m.account,
      paidThisRound: this.paidThisRound(pubkey),
      arrears: this.arrearsOf(pubkey),
      balance: m.balance,
      received: m.received,
      isRecipientThisRound: !this.isFinished() &&
        this.recipientFor(this.round).pubkey === pubkey,
    };
  };

  return {
    ArisanSim: ArisanSim,
    CONTRIBUTION_DEFAULT: CONTRIBUTION_DEFAULT,
    INITIAL_BALANCE: INITIAL_BALANCE,
    formatTari: formatTari,
    formatMicro: formatMicro,
  };
});
