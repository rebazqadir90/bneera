(function(){
  function getVisitorId(){
    try {
      var id = localStorage.getItem('bneera-visitor-id');
      if(!id){
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem('bneera-visitor-id', id);
      }
      return id;
    } catch(e){
      return 'anon-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
  }

  var visitorId = getVisitorId();

  function send(type, path, label){
    var payload = JSON.stringify({ type: type, path: path, label: label || '', visitorId: visitorId });
    try {
      if(navigator.sendBeacon){
        navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch(e){}
    try {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    } catch(e){}
  }

  send('pageview', location.pathname);

  function labelFor(el){
    var node = el;
    while(node && node !== document.body && node.tagName){
      var tag = node.tagName;
      if(tag === 'A' || tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit)$/i.test(node.type || ''))){
        var text = (node.textContent || node.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if(!text && tag === 'A'){ text = node.getAttribute('href') || ''; }
        return tag + ': ' + (text || '(no label)');
      }
      node = node.parentElement;
    }
    var fallback = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return (el.tagName || 'EL') + (fallback ? ': ' + fallback : '');
  }

  document.addEventListener('click', function(e){
    send('click', location.pathname, labelFor(e.target));
  }, true);
})();
