(function(){
  "use strict";
  function yearFromText(text){const years=[...String(text||"").matchAll(/(?:19|20)\d{2}/g)].map(match=>Number(match[0])).filter(Boolean); return years.length?Math.max(...years):0;}
  function videoYear(video){return yearFromText(`${video.path||""} ${video.folder||""} ${video.title||""}`);}
  function videoFileCompare(a,b){return String(a.path||a.title||"").localeCompare(String(b.path||b.title||""),undefined,{numeric:true,sensitivity:"base"});}
  function buildPlaybackState({videoQueue,videoQueueIndex,selectedVideoId,currentTime,videoRepeatMode}){return {videoQueue:[...videoQueue],videoQueueIndex,selectedVideoId,currentTime:Number.isFinite(currentTime)?currentTime:0,videoRepeatMode,updatedAt:Date.now()};}
  function parsePlaybackState(raw,validIds){
    let state=null;
    try{state=JSON.parse(raw||"null");}catch{return null;}
    if(!state||!Array.isArray(state.videoQueue)||!state.videoQueue.length)return null;
    const videoQueue=state.videoQueue.map(Number).filter(id=>validIds.has(id));
    return videoQueue.length?{...state,videoQueue,videoQueueIndex:Math.min(Math.max(Number(state.videoQueueIndex)||0,0),videoQueue.length-1)}:null;
  }
  function prepareSource(player,video,{resumeAt=0,autoplay=true}={}){
    const seconds=Number(resumeAt)||0;
    if(seconds>0){
      player.addEventListener("loadedmetadata",()=>{
        if(Number.isFinite(player.duration))player.currentTime=Math.min(seconds,Math.max(0,player.duration-.25));
      },{once:true});
    }
    player.src=video.video_url;
    player.load();
    if(!autoplay){player.pause(); return;}
    const pending=player.play();
    if(pending&&typeof pending.catch==="function")pending.catch(()=>{});
  }
  window.MediaPlayerVideoDomain={yearFromText,videoYear,videoFileCompare,buildPlaybackState,parsePlaybackState,prepareSource};
})();
