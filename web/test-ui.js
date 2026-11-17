// Tari Arisan — UI smoke test (node, no browser needed).
//
// SPDX-License-Identifier: MIT
//
// Loads app.js against a minimal stub `document` and drives the real
// click handlers: contribute / close / pay arrears / time controls /
// demo scripts / violation buttons / tabs / live-mode gating. Run:
// `node test-ui.js` (exit 0 = all pass).

"use strict";

var fs = require("fs");
var vm = require("vm");

// --- Minimal DOM stub: only the APIs app.js uses. ---
function makeElement(id) {
  var listeners = {};
  var classes = new Set();
  return {
    id: id,
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
    _listeners: listeners,
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      toggle: function (c, force) {
        if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (force) classes.add(c); else classes.delete(c);
      },
      contains: function (c) { return classes.has(c); },
    },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    click: function () { (listeners.click || []).forEach(function (fn) { fn(); }); },
    _classes: classes,
  };
}

var elements = {};
var documentStub = {
  getElementById: function (id) {
    if (!elements[id]) elements[id] = makeElement(id);
    return elements[id];
  },
};

// Timers: capture setInterval callbacks instead of running them.
var intervals = [];
var timeouts = [];
var sandbox = {
  console: console,
  document: documentStub,
  window: {},
  setTimeout: function (fn, ms) { timeouts.push(fn); return timeouts.length; },
  clearTimeout: function () {},
  setInterval: function (fn, ms) { intervals.push(fn); return intervals.length; },
  clearInterval: function () {},
  Promise: Promise,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox; // window === global in this stub
vm.createContext(sandbox);

// Load arisan-sim.js first (UMD -> module.exports in node; expose as global).
var simLib = require("./arisan-sim.js");
sandbox.ArisanSim = simLib;

// Load app.js in the sandbox.
vm.runInContext(fs.readFileSync("./app.js", "utf8"), sandbox, { filename: "app.js" });
var App = sandbox.window.TariArisanApp;

var passed = 0, failed = 0, failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; failures.push(name + ": " + e.message); console.log("FAIL  " + name + " — " + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || "value") + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }
function contains(hay, needle, what) {
  if (String(hay).indexOf(needle) === -1) throw new Error((what || "text") + ": expected to contain " + JSON.stringify(needle) + ", got " + JSON.stringify(hay).slice(0, 300));
}
function click(id) { elements[id].click(); }
function setSelect(id, v) { documentStub.getElementById(id).value = v; }
function setInput(id, v) { documentStub.getElementById(id).value = String(v); }

console.log("Tari Arisan UI smoke tests");

test("initial render shows round 1, Ayu as recipient, vault 0", function () {
  eq(elements["stat-round"].textContent, "1 / 4", "round");
  eq(elements["stat-recipient"].textContent, "Ayu", "recipient");
  eq(elements["stat-vault"].textContent, "0 TARI", "vault");
  contains(elements["members-table"].innerHTML, "Ayu", "table has Ayu");
  contains(elements["members-table"].innerHTML, "Giliran ronde ini", "recipient pill");
  contains(elements["members-table"].innerHTML, "Belum bayar", "unpaid pill");
});

test("contribute as Ayu marks her paid and grows the vault", function () {
  setSelect("act-as", "ayu");
  setInput("amount-input", 100000);
  click("btn-contribute");
  eq(App.getSim().paidThisRound("ayu"), true, "Ayu paid");
  eq(App.getSim().vault, 100000, "vault");
  contains(elements["members-table"].innerHTML, "Sudah bayar", "paid pill");
  contains(elements["action-message"].textContent, "diterima", "success message");
});

test("wrong amount is rejected and logged", function () {
  setSelect("act-as", "budi");
  click("btn-try-wrong-amount");
  eq(App.getSim().paidThisRound("budi"), false, "Budi not paid");
  contains(elements["action-message"].textContent, "Ditolak", "rejection message");
  contains(elements["action-message"].textContent, "exactly the contribution amount", "reason");
  var rejects = App.getLog().filter(function (e) { return e.kind === "reject"; });
  eq(rejects.length >= 1, true, "rejection logged");
});

test("non-member contribution is rejected", function () {
  click("btn-try-non-member");
  contains(elements["action-message"].textContent, "Only a circle member", "reason");
});

test("early close is rejected, then close works at the deadline", function () {
  click("btn-try-early-close");
  contains(elements["action-message"].textContent, "Ditolak", "early close rejected");
  click("btn-skip-deadline");
  click("btn-close");
  eq(App.getSim().round, 1, "round advanced to 1");
  contains(elements["stat-round"].textContent, "2 / 4", "round label");
});

test("arrears banner appears when a member misses a round", function () {
  click("btn-demo-missed"); // resets; Ayu skips round 0, round closes deferred
  eq(App.getSim().arrearsOf("ayu"), 100000, "Ayu arrears");
  eq(elements["arrears-banner"]._classes.has("hidden"), false, "banner visible");
  contains(elements["arrears-banner"].textContent, "Ayu", "banner names Ayu");
  contains(elements["members-table"].innerHTML, "Menunggak", "arrears pill");
});

test("pay arrears restores standing", function () {
  setSelect("act-as", "ayu");
  click("btn-pay-arrears");
  eq(App.getSim().arrearsOf("ayu"), 0, "arrears cleared");
  eq(elements["arrears-banner"]._classes.has("hidden"), true, "banner hidden again");
});

test("auto-tick advances epochs via captured interval", function () {
  click("btn-reset");
  var before = App.getSim().info().currentEpoch;
  click("btn-auto-tick"); // starts interval (captured, not run)
  eq(intervals.length >= 1, true, "interval registered");
  intervals[intervals.length - 1](); // fire one tick manually
  eq(App.getSim().info().currentEpoch, before + 1, "epoch advanced");
  click("btn-auto-tick"); // stop
});

test("reset starts a fresh circle", function () {
  click("btn-reset");
  eq(App.getSim().round, 0, "round 0");
  eq(App.getSim().vault, 0, "vault 0");
  eq(App.getSim().arrearsOf("ayu"), 0, "no arrears");
});

test("live tab shows configured state (verified) and liveWrite is honest about page writes", function () {
  click("tab-live");
  eq(elements["panel-live"]._classes.has("hidden"), false, "live panel visible");
  eq(elements["panel-sim"]._classes.has("hidden"), true, "sim panel hidden");
  contains(elements["live-config"].textContent, "template_f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5", "template shown");
  contains(elements["live-config"].textContent, "TERVERIFIKASI", "live writes verified shown");
  contains(App.liveWrite("contribute"), "belum tersedia", "liveWrite says page writes are not available (verified via walletd instead)");
  click("tab-sim");
  eq(elements["panel-sim"]._classes.has("hidden"), false, "back to sim");
});

test("live connect without a wallet reports honestly", function () {
  click("tab-live");
  return App; // connect is async; drive it below
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) { console.log("Failures:\n- " + failures.join("\n- ")); process.exit(1); }

// Async check: connect with no window.tari must resolve with a clear message.
App.renderLiveConfig();
elements["btn-connect"].click();
setTimeout(function () {
  var msg = elements["live-wallet-status"].textContent;
  if (msg.indexOf("window.tari tidak ditemukan") === -1) {
    console.log("FAIL  live connect without wallet — got: " + JSON.stringify(msg));
    process.exit(1);
  }
  console.log("  ok  live connect without wallet reports honestly");
  console.log("\nAll UI smoke tests passed.");
}, 0);
