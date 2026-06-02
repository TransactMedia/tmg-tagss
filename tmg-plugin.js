// TMG Plugin - Awin MasterTag + CM360 Floodlight Tracking
// Supports dynamic advertiser parameters via URL query string
// Handles both Purchase Confirmation and Site Visit tracking in one plugin
// Usage: tmg-plugin.js?advertiserId=XXXXXX&type=XXXXXX&category=XXXXXX&svtype=XXXXXX&svcategory=XXXXXX

(function () {

  function getScriptParams() {
    var scripts = document.querySelectorAll('script[src*="tmg-plugin.js"]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src && src.indexOf('tmg-plugin.js') !== -1) {
        var query = src.split('?')[1] || '';
        var params = {};
        query.split('&').forEach(function(pair) {
          var parts = pair.split('=');
          if (parts[0]) {
            params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
          }
        });
        return params;
      }
    }
    return {};
  }

  var params = getScriptParams();
  var advertiserId       = params.advertiserId  || '';
  var floodlightType     = params.type          || '';
  var floodlightCategory = params.category      || '';
  var svType             = params.svtype        || '';
  var svCategory         = params.svcategory    || '';

  window.aw_tmg_q = window.aw_tmg_q || [];

  if (typeof window.aw_tmg_order === "object"
      && window.aw_tmg_order
      && window.aw_tmg_order.orderId
      && advertiserId) {

    window.aw_tmg_q.push({
      event: "purchase",
      order: window.aw_tmg_order
    });

    if (advertiserId && floodlightType && floodlightCategory) {

      var sku = '';
      if (window.aw_tmg_order.products && window.aw_tmg_order.products.length > 0) {
        sku = window.aw_tmg_order.products.map(function(product) {
          return product.id || '';
        }).filter(Boolean).join('|');
      }

      var floodlight = new Image(1, 1);
      floodlight.src = "https://ad.doubleclick.net/ddm/activity/src=" + advertiserId
        + ";type=" + floodlightType
        + ";cat=" + floodlightCategory
        + ";qty=1"
        + ";cost=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
        + ";u1=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
        + ";u2=" + encodeURIComponent(window.aw_tmg_order.totalAmount || "")
        + ";u3=" + encodeURIComponent(window.aw_tmg_order.currency || "GBP")
        + ";u4=" + encodeURIComponent(window.aw_tmg_order.couponCode || "")
        + ";u5=" + encodeURIComponent(sku)
        + ";ord=" + encodeURIComponent(window.aw_tmg_order.orderId || "")
        + "?";
    }

  } else {

    window.aw_tmg_q.push({ event: "other" });

    if (advertiserId && svType && svCategory) {
      var siteVisit = new Image(1, 1);
      siteVisit.src = "https://ad.doubleclick.net/ddm/activity/src=" + advertiserId
        + ";type=" + svType
        + ";cat=" + svCategory
        + ";ord=" + Math.round(Math.random() * 1000000000)
        + "?";
    }

  }

})();
