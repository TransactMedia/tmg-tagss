// TMG Plugin - Awin MasterTag + CM360 Floodlight Tracking
(function () {

  window.aw_tmg_q = window.aw_tmg_q || [];

  if (typeof window.aw_tmg_order === "object" 
      && window.aw_tmg_order 
      && window.aw_tmg_order.orderId) {

    // PART 1 — Tell Awin about the purchase
    window.aw_tmg_q.push({ 
      event: "purchase", 
      order: window.aw_tmg_order 
    });

    // PART 2 — Fire CM360 Floodlight → connects to DV360
    var floodlight = new Image(1, 1);
    floodlight.src = "https://ad.doubleclick.net/ddm/activity/src=16624327"
      + ";type=tmgco0"
      + ";cat=tmg-d0"
      + ";qty=1"
      + ";cost=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
      + ";u1=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
      + ";u2=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
      + ";u3=" + encodeURIComponent(window.aw_tmg_order.currency || "GBP")
      + ";ord=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
      + "?";

  } else {

    // No purchase on this page
    window.aw_tmg_q.push({ event: "other" });

  }

})();
