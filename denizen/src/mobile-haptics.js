window.DenizenHaptics = { tap: () => vibrate(8), impact: () => vibrate(22), notify: () => vibrate([12,40,12]) };
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch(_){} }
