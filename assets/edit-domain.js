(function(){
  "use strict";
  const editableFields=["title","artist","album","albumartist","date","tracknumber","genre"];
  function metadataPayload(form){const raw=Object.fromEntries(new FormData(form).entries()); return Object.fromEntries(editableFields.filter(field=>field in raw).map(field=>[field,String(raw[field]??"").trim()]));}
  function bulkMetadataPayload(inputs){return Object.fromEntries(editableFields.filter(field=>inputs[field]).map(field=>[field,String(inputs[field].value??"").trim()]));}
  window.MediaPlayerEditDomain={editableFields,metadataPayload,bulkMetadataPayload};
})();
