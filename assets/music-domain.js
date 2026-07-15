(function(){
  "use strict";
  function buildPlaybackState({queue,queueIndex,playingId,selectedId,activePlaylistId,currentTime,repeatMode}){
    return {queue:[...queue],queueIndex,playingId,selectedId,activePlaylistId,currentTime:Number.isFinite(currentTime)?currentTime:0,repeatMode,updatedAt:Date.now()};
  }
  function parsePlaybackState(raw,validIds){
    let state=null;
    try{state=JSON.parse(raw||"null");}catch{return null;}
    if(!state||!Array.isArray(state.queue)||!state.queue.length)return null;
    const queue=state.queue.map(Number).filter(id=>validIds.has(id));
    return queue.length?{...state,queue,queueIndex:Math.min(Math.max(Number(state.queueIndex)||0,0),queue.length-1)}:null;
  }
  function prepareSource(player,track,{resumeAt=0}={}){
    const seconds=Number(resumeAt)||0;
    if(seconds>0){
      player.addEventListener("loadedmetadata",()=>{
        if(Number.isFinite(player.duration))player.currentTime=Math.min(seconds,Math.max(0,player.duration-.25));
      },{once:true});
    }
    player.src=track.audio_url;
    player.load();
  }
  window.MediaPlayerMusicDomain={buildPlaybackState,parsePlaybackState,prepareSource};
})();
