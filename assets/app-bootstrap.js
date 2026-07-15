(function(){
  "use strict";
  const start=window.MediaPlayerStart;
  if(typeof start!=="function")throw new Error("Media player coordinator did not register startup.");
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})();
