(function(){
  "use strict";
  function queueMatchesPlaylist(queue,playlist){return Boolean(playlist)&&queue.length===playlist.track_ids.length&&queue.every((id,index)=>id===playlist.track_ids[index]);}
  function uniqueAvailableTrackIds(ids,tracks){const available=new Set(tracks.map(track=>track.id)); return [...new Set(ids.map(Number))].filter(id=>available.has(id));}
  async function request(url,options={}){const response=await fetch(url,{cache:"no-store",...options}); let result={}; try{result=await response.json();}catch{} if(!response.ok||result.ok===false)throw new Error(result.error||"Playlist request failed."); return result;}
  window.MediaPlayerPlaylistDomain={queueMatchesPlaylist,uniqueAvailableTrackIds,request};
})();
