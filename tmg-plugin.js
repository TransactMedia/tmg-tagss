// TMG Plugin - Awin MasterTag + CM360 Floodlight Tracking
// Supports dynamic advertiser parameters via URL query string
// Handles both Purchase Confirmation and Site Visit tracking in one plugin
// Usage: tmg-plugin.js?advertiserId=XXXXXX&type=XXXXXX&category=XXXXXX&svtype=XXXXXX&svcategory=XXXXXX
//        Optional: &debug=1 to log resolved consent + the exact payloads sent to Awin/CM360
//        Optional: &consentString=...&gdprApplies=1 to force a consent value for testing
//
// CONSENT HANDLING:
// - Reads IAB TCF v2 consent via __tcfapi if a CMP is present on the page. Uses
//   addEventListener (not a single getTCData snapshot) so we don't act on stale
//   data while the consent banner is still on screen (eventStatus 'cmpuishown') -
//   we wait for 'tcloaded' or 'useractioncomplete', or fall back on timeout.
// - Falls back to a manual override via ?consentString=...&gdprApplies=1 on the
//   script URL, or window.aw_tmg_consent = { gdprApplies, consentString }, in case
//   the site's CMP isn't TCF-compliant or you need to force a value for testing.
// - By design/decision: when consent status can't be determined at all (no CMP,
//   no override), this still reports gdpr=0/cons=0, same as an explicit decline -
//   and tracking still fires either way; the cons/gdpr flags are informational
//   for Awin/CM360 to act on downstream, not a gate in this script. (Confirmed
//   with TMG - not changing this without an explicit ask.)
// - NOTE: confirm the exact field names Awin's MasterTag expects for your account
//   (gdpr / gdpr_consent / consent / cons are all seen across different Awin
//   integrations) and the aw_tmg_q queue name itself - these are still unconfirmed
//   against Awin's docs for this account, per the original implementation note.
//
// RELIABILITY FIXES (this revision):
// - De-dupes purchase tracking per orderId (sessionStorage) so a refreshed or
//   back-navigated confirmation page doesn't double-fire the Floodlight pixel
//   or the Awin queue push for the same order.
// - Script-tag detection now prefers document.currentScript (exact match) and
//   falls back to the LAST matching <script> tag rather than the first, so it
//   behaves correctly if the tag is ever included more than once on a page.
// - Script params are parsed once and reused, instead of re-parsing the DOM
//   inside the tracking callback.
// - Debug mode (?debug=1 on the script URL, or window.aw_tmg_debug = true) logs
//   the resolved consent object and the exact payloads sent to Awin's queue and
//   the Floodlight pixel, so you can verify on any given brand's site whether a
//   CMP is actually being detected and what's being sent, without guesswork.

(function () {

  var CONFIG = {
    defaultCurrency: 'GBP',       // used only when aw_tmg_order.currency is missing
    consentTimeoutMs: 1500,       // don't let tracking hang if the CMP is slow/broken
    floodlightHost: 'https://ad.doubleclick.net/ddm/activity/',
    dedupeStorageKey: 'tmg_tracked_orders'
  };

  // --- Script params ---------------------------------------------------

  function getScriptParams() {
    var src = null;

    if (document.currentScript && document.currentScript.src) {
      src = document.currentScript.src;
    } else {
      var scripts = document.querySelectorAll('script[src*="tmg-plugin.js"]');
      if (scripts.length > 0) {
        // Most recently added matching tag, in case the plugin is ever included
        // more than once on the same page.
        src = scripts[scripts.length - 1].src;
      }
    }

    if (!src) return {};

    var query = src.split('?')[1] || '';
    var params = {};
    query.split('&').forEach(function (pair) {
      if (!pair) return;
      var parts = pair.split('=');
      if (parts[0]) {
        // rejoin remainder in case the value itself contains '='
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join('=') || '');
      }
    });
    return params;
  }

  var scriptParams = getScriptParams();

  var DEBUG = scriptParams.debug === '1' || scriptParams.debug === 'true' || window.aw_tmg_debug === true;

  function debugLog() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ['[TMG Plugin]'].concat(Array.prototype.slice.call(arguments)));
    } catch (e) { /* console unavailable - ignore */ }
  }

  // --- Duplicate-fire guard (purchase confirmation refresh/back-button) ----

  function hasAlreadyTrackedOrder(orderId) {
    try {
      var raw = sessionStorage.getItem(CONFIG.dedupeStorageKey) || '';
      var ids = raw ? raw.split(',') : [];
      return ids.indexOf(String(orderId)) !== -1;
    } catch (e) {
      // storage unavailable (e.g. private browsing) - fail open so we don't
      // silently lose tracking entirely; dedupe just won't apply here.
      return false;
    }
  }

  function markOrderTracked(orderId) {
    try {
      var raw = sessionStorage.getItem(CONFIG.dedupeStorageKey) || '';
      var ids = raw ? raw.split(',') : [];
      if (ids.indexOf(String(orderId)) === -1) {
        ids.push(String(orderId));
        sessionStorage.setItem(CONFIG.dedupeStorageKey, ids.join(','));
      }
    } catch (e) { /* storage unavailable - nothing to persist */ }
  }

  // --- Consent resolution -------------------------------------------------

  function getManualConsentOverride(params) {
    // 1. Script URL params take priority (useful for testing/forcing a value)
    if (params.consentString || params.gdprApplies) {
      return {
        gdprApplies: params.gdprApplies === '1' || params.gdprApplies === 'true',
        consentString: params.consentString || ''
      };
    }
    // 2. Page-level global, e.g. set by your CMP wrapper before this script runs
    if (window.aw_tmg_consent && typeof window.aw_tmg_consent === 'object') {
      return {
        gdprApplies: !!window.aw_tmg_consent.gdprApplies,
        consentString: window.aw_tmg_consent.consentString || ''
      };
    }
    return null;
  }

  // Fires the given callback with { gdprApplies, consentString } once resolved.
  // Tries __tcfapi (IAB TCF v2) first, via addEventListener so we can wait past
  // a "banner still shown" state rather than acting on it; falls back to manual
  // override; falls back to "no consent info available" rather than assuming
  // consent.
  function resolveConsent(params, callback) {
    var manual = getManualConsentOverride(params);

    if (typeof window.__tcfapi === 'function') {
      var settled = false;
      var listenerId = null;

      function settle(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (listenerId !== null) {
          try { window.__tcfapi('removeEventListener', 2, function () {}, listenerId); } catch (e) {}
        }
        callback(result);
      }

      var timeout = setTimeout(function () {
        debugLog('TCF resolution timed out after', CONFIG.consentTimeoutMs, 'ms - using manual override / unknown');
        settle(manual || { gdprApplies: null, consentString: '' });
      }, CONFIG.consentTimeoutMs);

      try {
        window.__tcfapi('addEventListener', 2, function (tcData, success) {
          if (settled) return;
          if (!success || !tcData) return; // wait for a better signal or the timeout

          if (tcData.listenerId !== undefined) listenerId = tcData.listenerId;

          // 'cmpuishown' = banner is currently visible, user hasn't decided yet -
          // keep waiting rather than treating this as the final answer.
          if (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete') {
            debugLog('TCF resolved via addEventListener, eventStatus=', tcData.eventStatus);
            settle({
              gdprApplies: !!tcData.gdprApplies,
              consentString: tcData.tcString || ''
            });
          }
        });
      } catch (e) {
        debugLog('__tcfapi threw, falling back:', e && e.message);
        clearTimeout(timeout);
        callback(manual || { gdprApplies: null, consentString: '' });
      }
      return;
    }

    // No TCF API on page at all
    debugLog('No __tcfapi found on page - using manual override / unknown');
    callback(manual || { gdprApplies: null, consentString: '' });
  }

  // --- Main tracking logic -------------------------------------------------

  function runTracking(params, consent) {
    var advertiserId       = params.advertiserId  || '';
    var floodlightType     = params.type          || '';
    var floodlightCategory = params.category      || '';
    var svType             = params.svtype        || '';
    var svCategory          = params.svcategory    || '';

    // cons=1 only when we positively know GDPR applies AND we have a consent
    // string; cons=0 if GDPR applies but consent is missing/declined; if we
    // genuinely don't know (no CMP found, gdprApplies null), we still send 0
    // rather than silently omitting it, so this is visible/debuggable in logs.
    // (Kept as-is per confirmed decision - not gating tracking on this value.)
    var consentGiven = !!(consent.gdprApplies && consent.consentString);
    var consFlag = consentGiven ? '1' : '0';

    debugLog('Resolved consent:', consent, '-> cons=' + consFlag, 'gdpr=' + (consent.gdprApplies ? '1' : '0'));

    window.aw_tmg_q = window.aw_tmg_q || [];

    if (typeof window.aw_tmg_order === "object"
        && window.aw_tmg_order
        && window.aw_tmg_order.orderId
        && advertiserId) {

      var orderId = window.aw_tmg_order.orderId;

      if (hasAlreadyTrackedOrder(orderId)) {
        debugLog('Order', orderId, 'already tracked this session - skipping duplicate fire (refresh/back-button guard)');
        return;
      }

      // Pass consent through to Awin's own MasterTag queue.
      // Confirm exact field names against Awin's MasterTag docs for this account.
      var queuePayload = {
        event: "purchase",
        order: window.aw_tmg_order,
        consent: {
          gdprApplies: !!consent.gdprApplies,
          consentString: consent.consentString || '',
          cons: consFlag
        }
      };
      window.aw_tmg_q.push(queuePayload);
      debugLog('Pushed to aw_tmg_q:', queuePayload);

      if (advertiserId && floodlightType && floodlightCategory) {
        var sku = '';
        if (window.aw_tmg_order.products && window.aw_tmg_order.products.length > 0) {
          sku = window.aw_tmg_order.products.map(function (product) {
            return product.id || '';
          }).filter(Boolean).join('|');
        }
        var floodlightSrc = "https://ad.doubleclick.net/ddm/activity/src=" + advertiserId
          + ";type=" + floodlightType
          + ";cat=" + floodlightCategory
          + ";qty=1"
          + ";cost=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
          + ";u1=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
          + ";u2=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
          + ";u3=" + encodeURIComponent(window.aw_tmg_order.currency || CONFIG.defaultCurrency)
          + ";u4=" + encodeURIComponent(window.aw_tmg_order.couponCode || "")
          + ";u5=" + encodeURIComponent(sku)
          + ";ord=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
          + ";cons=" + consFlag
          + ";gdpr=" + (consent.gdprApplies ? '1' : '0')
          + ";gdpr_consent=" + encodeURIComponent(consent.consentString || '')
          + "?";

        var floodlight = new Image(1, 1);
        floodlight.src = floodlightSrc;
        debugLog('Firing purchase Floodlight pixel:', floodlightSrc);
      }

      // Mark tracked only after building the fire calls above, so a thrown
      // error before this point doesn't falsely mark the order as tracked.
      markOrderTracked(orderId);

    } else {
      var otherPayload = {
        event: "other",
        consent: {
          gdprApplies: !!consent.gdprApplies,
          consentString: consent.consentString || '',
          cons: consFlag
        }
      };
      window.aw_tmg_q.push(otherPayload);
      debugLog('Pushed to aw_tmg_q:', otherPayload);

      if (advertiserId && svType && svCategory) {
        var siteVisitSrc = "https://ad.doubleclick.net/ddm/activity/src=" + advertiserId
          + ";type=" + svType
          + ";cat=" + svCategory
          + ";ord=" + Math.round(Math.random() * 1000000000)
          + ";cons=" + consFlag
          + ";gdpr=" + (consent.gdprApplies ? '1' : '0')
          + ";gdpr_consent=" + encodeURIComponent(consent.consentString || '')
          + "?";

        var siteVisit = new Image(1, 1);
        siteVisit.src = siteVisitSrc;
        debugLog('Firing site-visit Floodlight pixel:', siteVisitSrc);
      }
    }
  }

  resolveConsent(scriptParams, function (consent) {
    runTracking(scriptParams, consent);
  });
})();
