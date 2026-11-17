// Tari Arisan — frontend wiring.
//
// SPDX-License-Identifier: MIT
//
// Two modes:
//  1. Simulation (default): ArisanSim (arisan-sim.js) runs the exact
//     contract rules in-browser. No wallet, no network, no money.
//  2. Live (Esmeralda): talks to the real published template through
//     the Sapient / Tari Universe provider (`window.tari`). The template
//     is published and the instruction encoding is verified on-chain via
//     walletd manifests (see PROOF.md) — but the page itself only READS
//     the live circle; its write buttons are not wired to a wallet yet,
//     rather than faking a transaction. Live writes from this page are a
//     v2 item (needs a Sapient test wallet to verify end-to-end).
//
// DOM usage is deliberately minimal (getElementById + innerHTML +
// addEventListener only) so the UI can be smoke-tested in node with a
// stub document (see test-ui.js).

(function () {
  "use strict";

  // ---------------------------------------------------------------
  // CONFIG — the live deployment addresses (published 2026-11-15).
  // Nothing else in this file needs to change for the live deployment.
  // ---------------------------------------------------------------
  var CONFIG = {
    NETWORK: "esmeralda", // "esmeralda" testnet | "mainnet"
    TEMPLATE_ADDRESS: "template_f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5", // published 2026-11-15, tx 4b5417e63d3d9625156dc6fc9ee891d37db0523eff8b1a0fe5c3fa227048c93d
    COMPONENT_ADDRESS: "component_fe42c4e6f21f2066cac7acdabb5fabcd9bd365af8aadd154ece22dd0d2f601e8", // live circle, created 2026-11-15, tx 7c4bbbc5d520e344bfd96c07fcf49867681f853a86cc97585de9bfcde3bb270b
    INDEXER_URL: "https://esme-indexer-a.ootle.tari.com/", // public Esmeralda indexer (also esme-indexer-b.ootle.tari.com)
    LIVE_WRITES_VERIFIED: true, // verified 2026-11-15: live manifest txs (submit_manifest) executed on Esmeralda — contribute + close_round confirmed on-chain (see PROOF.md)
    EPOCH_TICK_MS: 15000, // simulated epoch length in the demo (real: mainnet ~20 min, Esmeralda ~1 h)
  };

  // arisan-sim.js exposes { ArisanSim, CONTRIBUTION_DEFAULT, formatTari, ... }
  // as window.ArisanSim in the browser (require() in node).
  var Lib = (typeof ArisanSim !== "undefined") ? ArisanSim : null;

  var DEMO_MEMBERS = [
    { name: "Ayu", pubkey: "ayu", account: "account-ayu" },
    { name: "Budi", pubkey: "budi", account: "account-budi" },
    { name: "Citra", pubkey: "citra", account: "account-citra" },
    { name: "Dewi", pubkey: "dewi", account: "account-dewi" },
  ];
  var OUTSIDER = { name: "Rudi (bukan anggota)", pubkey: "rudi-outsider", account: "account-rudi" };

  var sim = null; // ArisanSim instance
  var logEntries = []; // { kind: "event"|"reject"|"note", text, meta }
  var lastEventCount = 0;
  var autoTickTimer = null;
  var autoPlaying = false;

  function el(id) { return document.getElementById(id); }

  function fmt(micro) { return Lib ? Lib.formatTari(micro) : micro + " µT"; }

  function newCircle() {
    sim = new Lib.ArisanSim({
      members: DEMO_MEMBERS,
      contribution: Lib.CONTRIBUTION_DEFAULT,
      rounds: 4,
      roundLength: 2,
    });
    logEntries = [];
    lastEventCount = 0;
    syncEngineLog();
    note("Lingkaran baru dibuat: 4 anggota, iuran " + fmt(Lib.CONTRIBUTION_DEFAULT) +
      " per ronde, 4 ronde. Ronde 1 — giliran Ayu.");
  }

  function note(text) {
    logEntries.push({ kind: "note", text: text, meta: "epoch " + sim.info().currentEpoch });
  }

  function reject(text) {
    logEntries.push({ kind: "reject", text: text, meta: "epoch " + sim.info().currentEpoch });
  }

  // Pull newly emitted engine events into the display log.
  function syncEngineLog() {
    for (var i = lastEventCount; i < sim.events.length; i++) {
      var e = sim.events[i];
      logEntries.push({
        kind: e.type === "RoundClosed" && /DEFERRED/.test(e.message) ? "deferred" : "event",
        text: e.message,
        meta: "ronde " + (e.round + 1) + " · epoch " + e.epoch,
      });
    }
    lastEventCount = sim.events.length;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render() {
    var info = sim.info();
    el("stat-round").textContent = sim.isFinished()
      ? "Selesai"
      : (info.round + 1) + " / " + info.roundsPerCircle;
    el("stat-epoch").textContent = String(info.currentEpoch);
    el("stat-deadline").textContent = sim.isFinished()
      ? "—"
      : "epoch " + info.roundDeadlineEpoch +
        (info.currentEpoch >= info.roundDeadlineEpoch
          ? " (tiba — bisa ditutup)"
          : " (" + (info.roundDeadlineEpoch - info.currentEpoch) + " epoch lagi)");
    el("stat-recipient").textContent = sim.isFinished()
      ? "—"
      : sim.recipientFor(info.round).name;
    el("stat-vault").textContent = fmt(info.vaultBalance);
    el("stat-status").textContent = sim.isFinished() ? "Selesai" : "Berjalan";

    // Arrears banner.
    var debtors = DEMO_MEMBERS.filter(function (m) { return sim.arrearsOf(m.pubkey) > 0; });
    var banner = el("arrears-banner");
    if (debtors.length > 0) {
      banner.classList.remove("hidden");
      banner.textContent = "Menunggak: " + debtors.map(function (m) {
        return m.name + " (" + fmt(sim.arrearsOf(m.pubkey)) + ")";
      }).join(", ") + " — lunasi sebelum giliranmu tiba, kalau tidak potmu hangus.";
    } else {
      banner.classList.add("hidden");
      banner.textContent = "";
    }

    // Members table.
    var rows = DEMO_MEMBERS.map(function (m) {
      var st = sim.memberState(m.pubkey);
      var statusPill = st.paidThisRound
        ? '<span class="pill pill-paid">Sudah bayar</span>'
        : '<span class="pill pill-unpaid">Belum bayar</span>';
      var extra = "";
      if (st.isRecipientThisRound) extra += ' <span class="pill pill-recipient">Giliran ronde ini</span>';
      if (st.arrears > 0) extra += ' <span class="pill pill-arrears">Menunggak ' + esc(fmt(st.arrears)) + "</span>";
      return "<tr><td><strong>" + esc(m.name) + "</strong>" + extra + "</td>" +
        "<td>" + statusPill + "</td>" +
        '<td class="num">' + esc(fmt(st.arrears)) + "</td>" +
        '<td class="num">' + esc(fmt(st.balance)) + "</td>" +
        '<td class="num">' + esc(fmt(st.received)) + "</td></tr>";
    }).join("");
    el("members-table").innerHTML =
      '<table class="members"><thead><tr><th>Anggota</th><th>Ronde ini</th>' +
      "<th>Tunggakan</th><th>Saldo</th><th>Diterima</th></tr></thead><tbody>" +
      rows + "</tbody></table>";

    // Buttons.
    el("btn-contribute").disabled = sim.isFinished() || autoPlaying;
    el("btn-close").disabled = sim.isFinished() || autoPlaying;
    el("btn-pay-arrears").disabled = sim.isFinished() || autoPlaying;
    el("btn-autoplay").disabled = autoPlaying;
    el("btn-demo-missed").disabled = autoPlaying;

    // Event log (newest last, like a ledger).
    el("event-log").innerHTML = logEntries.map(function (e) {
      var cls = e.kind === "reject" ? "ev-reject" : e.kind === "deferred" ? "ev-deferred" : "ev-ok";
      return '<li class="' + cls + '">' + esc(e.text) +
        '<span class="ev-meta">' + esc(e.meta) + "</span></li>";
    }).join("");
  }

  function showMessage(text, isError) {
    var m = el("action-message");
    m.textContent = text;
    m.classList.remove("ok");
    m.classList.remove("err");
    m.classList.add(isError ? "err" : "ok");
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- Simulation actions (each mirrors one contract call) ----

  function actAs() { return el("act-as").value; }

  function amountInput() {
    var v = parseInt(el("amount-input").value, 10);
    return isNaN(v) ? 0 : v;
  }

  function doContribute(pubkey, amount) {
    try {
      sim.contribute({ member: pubkey, round: sim.info().round, amount: amount });
      syncEngineLog();
      showMessage("Pembayaran diterima: " + fmt(amount) + " untuk ronde " + (sim.info().round + 1) + ".", false);
    } catch (e) {
      reject("DITOLAK — bayar iuran: " + e.message);
      showMessage("Ditolak: " + e.message, true);
    }
    render();
  }

  function doClose() {
    try {
      var r = sim.closeRound({ caller: actAs() });
      syncEngineLog();
      showMessage(r.deferred
        ? "Ronde " + (r.round + 1) + " ditutup — pembayaran DITUNDA (penerima menunggak / pot kosong). Pot menggelinding."
        : "Ronde " + (r.round + 1) + " ditutup — " + r.recipient + " menerima " + fmt(r.amount) + ".", false);
    } catch (e) {
      reject("DITOLAK — tutup ronde: " + e.message);
      showMessage("Ditolak: " + e.message, true);
    }
    render();
  }

  function doPayArrears() {
    var who = actAs();
    try {
      var owed = sim.arrearsOf(who);
      sim.payArrears({ member: who, amount: owed });
      syncEngineLog();
      showMessage("Tunggakan " + fmt(owed) + " lunas — giliranmu aman.", false);
    } catch (e) {
      reject("DITOLAK — lunasi tunggakan: " + e.message);
      showMessage("Ditolak: " + e.message, true);
    }
    render();
  }

  // ---- Time (simulated epochs) ----

  function tickEpoch() {
    sim.advanceEpoch(1);
    if (sim.isFinished()) stopAutoTick();
    render();
  }

  function stopAutoTick() {
    if (autoTickTimer !== null) {
      clearInterval(autoTickTimer);
      autoTickTimer = null;
      el("btn-auto-tick").textContent = "Jalankan waktu otomatis (15 dtk/epoch)";
    }
  }

  function toggleAutoTick() {
    if (autoTickTimer !== null) { stopAutoTick(); render(); return; }
    autoTickTimer = setInterval(tickEpoch, CONFIG.EPOCH_TICK_MS);
    el("btn-auto-tick").textContent = "Hentikan waktu otomatis";
    render();
  }

  function skipToDeadline() {
    var info = sim.info();
    if (sim.isFinished()) { showMessage("Lingkaran sudah selesai.", true); return; }
    var diff = info.roundDeadlineEpoch - info.currentEpoch;
    if (diff <= 0) { showMessage("Tenggat ronde ini sudah tiba — ronde bisa ditutup.", false); return; }
    sim.advanceEpoch(diff);
    showMessage("Waktu dilompati " + diff + " epoch — tenggat ronde tiba.", false);
    render();
  }

  // ---- Demo scripts ----

  function demoMissedPayment() {
    newCircle();
    // Round 0: everyone pays except Ayu (the recipient) — her turn is deferred.
    ["budi", "citra", "dewi"].forEach(function (pk) {
      try { sim.contribute({ member: pk, round: 0, amount: Lib.CONTRIBUTION_DEFAULT }); } catch (e) { /* no-op */ }
    });
    syncEngineLog();
    skipToDeadline();
    doClose();
    showMessage("Demo: Ayu tidak bayar di ronde 1 — gilirannya hangus dan ia menunggak " +
      fmt(Lib.CONTRIBUTION_DEFAULT) + ". Coba lunasi sebagai Ayu (pilih Ayu, klik Lunasi tunggakan).", false);
    render();
  }

  function autoPlay() {
    if (autoPlaying) return;
    autoPlaying = true;
    stopAutoTick();
    newCircle();
    render();
    var chain = Promise.resolve();
    for (var round = 0; round < 4; round++) {
      (function (r) {
        chain = chain.then(function () {
          DEMO_MEMBERS.forEach(function (m) {
            try { sim.contribute({ member: m.pubkey, round: r, amount: Lib.CONTRIBUTION_DEFAULT }); } catch (e) { /* no-op */ }
          });
          syncEngineLog();
          render();
          return sleep(400);
        }).then(function () {
          var info = sim.info();
          if (!sim.isFinished()) sim.advanceEpoch(info.roundDeadlineEpoch - info.currentEpoch);
          try { sim.closeRound({ caller: "ayu" }); } catch (e) { /* no-op */ }
          syncEngineLog();
          render();
          return sleep(500);
        });
      })(round);
    }
    chain.then(function () {
      autoPlaying = false;
      showMessage("Satu lingkaran penuh selesai — semua anggota setor 0,4 TARI dan masing-masing menerima pot 0,4 TARI tepat satu kali.", false);
      render();
    });
  }

  function resetCircle() {
    stopAutoTick();
    newCircle();
    el("amount-input").value = String(Lib.CONTRIBUTION_DEFAULT);
    showMessage("", false);
    render();
  }

  // ---- "Try to break the rules" demos ----

  function tryWrongAmount() {
    doContribute(actAs(), Lib.CONTRIBUTION_DEFAULT - 1);
  }

  function tryNonMember() {
    doContribute(OUTSIDER.pubkey, Lib.CONTRIBUTION_DEFAULT);
  }

  function tryEarlyClose() {
    if (sim.isFinished()) { showMessage("Lingkaran sudah selesai.", true); return; }
    if (sim.info().currentEpoch >= sim.info().roundDeadlineEpoch) {
      showMessage("Ronde ini sudah mencapai tenggat — penolakan ini hanya bisa dicoba sebelum tenggat. Reset lingkaran untuk mencobanya.", true);
      return;
    }
    doClose();
  }

  // ---- Tabs ----

  function showTab(which) {
    var simTab = which === "sim";
    el("panel-sim").classList.toggle("hidden", !simTab);
    el("panel-live").classList.toggle("hidden", simTab);
    el("tab-sim").classList.toggle("active", simTab);
    el("tab-live").classList.toggle("active", !simTab);
    el("mode-badge").textContent = simTab
      ? "MODE SIMULASI — tidak ada uang sungguhan di sini"
      : "MODE LIVE — Esmeralda testnet (tTARI, tidak bernilai)";
    if (!simTab) renderLiveConfig();
  }

  // ---- Live mode (Esmeralda / Sapient) ----
  //
  // What is verified (read 2026-11-15, universe.tari.mw/integration):
  //  - the page includes tari-connector.js, which supplies `window.tari`
  //    when embedded in Tari Universe and stands aside when the Sapient
  //    extension owns it;
  //  - `window.tari.request({ method })` with methods tari_requestAccounts,
  //    tari_getAccounts, tari_getNetwork, tari_getWalletAddress,
  //    tari_getBalances, tari_getCapabilities, tari_getSubstate,
  //    tari_signAndSubmitTransaction, tari_disconnect; errors 4001
  //    (user rejected), 4100 (not connected), 4200 (unsupported).
  //
  // What IS verified (2026-11-15, Esmeralda):
  //  - the exact JSON shape of the `instructions` argument to
  //    tari_signAndSubmitTransaction (CallMethod / withdraw / bucket
  //    references) was confirmed against the live walletd
  //    (`transactions.submit_manifest`, Tari manifest DSL) and by real
  //    on-chain executions — contribute + close_round on the live circle
  //    (see PROOF.md). LIVE_WRITES_VERIFIED is therefore true for the
  //    walletd path. The page itself does NOT submit transactions:
  //    liveWrite() says so honestly, and the write buttons stay disabled
  //    until a page-level write path is built and tested with a real
  //    Sapient wallet (v2).

  var liveAccounts = [];

  function renderLiveConfig() {
    var lines = [
      "Network:        " + CONFIG.NETWORK,
      "Template:       " + (CONFIG.TEMPLATE_ADDRESS || "(belum diset)"),
      "Component:      " + (CONFIG.COMPONENT_ADDRESS || "(belum diset)"),
      "Indexer:        " + (CONFIG.INDEXER_URL || "(belum diset)"),
      "Live writes:    " + (CONFIG.LIVE_WRITES_VERIFIED ? "TERVERIFIKASI (via walletd, lihat PROOF.md)" : "BELUM terverifikasi"),
      "Provider:       " + (typeof window !== "undefined" && window.tari ? "window.tari tersedia" : "window.tari TIDAK ditemukan"),
    ];
    el("live-config").textContent = lines.join("\n");
  }

  function liveWrite(action) {
    // No page-level write path exists yet: the write buttons in
    // index.html are disabled and nothing calls this. Live writes were
    // executed and verified via walletd manifests (see PROOF.md), not
    // from this page. Returns an honest message instead of pretending.
    return "Penulisan live dari halaman ini belum tersedia — jalankan " +
      "manifest di manifests/ lewat walletd (lihat PROOF.md).";
  }

  function connectLive() {
    var status = el("live-wallet-status");
    if (typeof window === "undefined" || !window.tari || !window.tari.request) {
      status.textContent = "window.tari tidak ditemukan. Install ekstensi Sapient (sapient.tari.mw) " +
        "atau buka halaman ini di dalam Tari Universe, lalu coba lagi.";
      renderLiveConfig();
      return Promise.resolve();
    }
    return window.tari.request({ method: "tari_requestAccounts" }).then(function (accounts) {
      liveAccounts = accounts || [];
      return window.tari.request({ method: "tari_getNetwork" });
    }).then(function (network) {
      var net = String(network || "").toLowerCase();
      var okNetwork = net.indexOf("esmeralda") !== -1 || net.indexOf("esme") !== -1;
      status.textContent = "Terhubung: " + liveAccounts.join(", ") + " — network: " + network +
        (okNetwork ? "" : " (PERINGATAN: bukan Esmeralda — ganti network di wallet ke Esmeralda)");
      return window.tari.request({ method: "tari_getCapabilities" });
    }).then(function (caps) {
      status.textContent += "\nCapabilities: " + JSON.stringify(caps);
      renderLiveConfig();
    }).catch(function (err) {
      var code = err && err.code;
      if (code === 4001) status.textContent = "Koneksi ditolak oleh pengguna (4001).";
      else if (code === 4100) status.textContent = "Belum terhubung (4100) — coba lagi.";
      else status.textContent = "Gagal terhubung: " + (err && err.message ? err.message : String(err));
      renderLiveConfig();
    });
  }

  function disconnectLive() {
    if (typeof window !== "undefined" && window.tari && window.tari.request) {
      window.tari.request({ method: "tari_disconnect" }).catch(function () { /* no-op */ });
    }
    liveAccounts = [];
    el("live-wallet-status").textContent = "Wallet belum terhubung.";
  }

  function loadLiveCircle() {
    var box = el("live-circle-state");
    if (!CONFIG.COMPONENT_ADDRESS) {
      box.textContent = "Belum ada COMPONENT_ADDRESS di konfigurasi — buat lingkaran live dulu.";
      return Promise.resolve();
    }
    if (typeof window === "undefined" || !window.tari || !window.tari.request) {
      box.textContent = "window.tari tidak ditemukan — hubungkan Sapient dulu.";
      return Promise.resolve();
    }
    box.textContent = "Memuat lingkaran " + CONFIG.COMPONENT_ADDRESS + " …";
    return window.tari.request({
      method: "tari_getSubstate",
      params: { substateId: CONFIG.COMPONENT_ADDRESS },
    }).then(function (substate) {
      box.textContent = JSON.stringify(substate, null, 2);
    }).catch(function (err) {
      box.textContent = "Gagal memuat lingkaran: " + (err && err.message ? err.message : String(err));
    });
  }

  // ---- Wire up ----

  el("btn-contribute").addEventListener("click", function () { doContribute(actAs(), amountInput()); });
  el("btn-close").addEventListener("click", doClose);
  el("btn-pay-arrears").addEventListener("click", doPayArrears);
  el("btn-advance-epoch").addEventListener("click", function () { tickEpoch(); });
  el("btn-skip-deadline").addEventListener("click", skipToDeadline);
  el("btn-auto-tick").addEventListener("click", toggleAutoTick);
  el("btn-autoplay").addEventListener("click", autoPlay);
  el("btn-demo-missed").addEventListener("click", demoMissedPayment);
  el("btn-try-wrong-amount").addEventListener("click", tryWrongAmount);
  el("btn-try-non-member").addEventListener("click", tryNonMember);
  el("btn-try-early-close").addEventListener("click", tryEarlyClose);
  el("btn-reset").addEventListener("click", resetCircle);
  el("tab-sim").addEventListener("click", function () { showTab("sim"); });
  el("tab-live").addEventListener("click", function () { showTab("live"); });
  el("btn-connect").addEventListener("click", connectLive);
  el("btn-disconnect").addEventListener("click", disconnectLive);
  el("btn-load-circle").addEventListener("click", loadLiveCircle);

  newCircle();
  render();

  // Test/debug handle (also used by the node smoke test).
  if (typeof window !== "undefined") {
    window.TariArisanApp = {
      CONFIG: CONFIG,
      getSim: function () { return sim; },
      getLog: function () { return logEntries; },
      doContribute: doContribute,
      doClose: doClose,
      doPayArrears: doPayArrears,
      tickEpoch: tickEpoch,
      skipToDeadline: skipToDeadline,
      resetCircle: resetCircle,
      liveWrite: liveWrite,
      renderLiveConfig: renderLiveConfig,
    };
  }
})();
