(function(){
  "use strict";
  function dateFromText(value,localDateString){return new Date(`${value||localDateString()}T00:00:00`);}
  function shiftDate(value,days,localDateString){const date=dateFromText(value,localDateString); date.setDate(date.getDate()+days); return localDateString(date);}
  function monthStart(value,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear(),date.getMonth(),1));}
  function monthEnd(value,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear(),date.getMonth()+1,0));}
  function yearStart(value,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear(),0,1));}
  function yearEnd(value,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear(),11,31));}
  function weekStart(value,localDateString){const date=dateFromText(value,localDateString); date.setDate(date.getDate()-date.getDay()); return localDateString(date);}
  function weekEnd(value,localDateString){return shiftDate(weekStart(value,localDateString),6,localDateString);}
  function shiftMonthAnchor(value,direction,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear(),date.getMonth()+direction,1));}
  function shiftYearAnchor(value,direction,localDateString){const date=dateFromText(value,localDateString); return localDateString(new Date(date.getFullYear()+direction,0,1));}
  window.MediaPlayerStatsDomain={dateFromText,shiftDate,monthStart,monthEnd,yearStart,yearEnd,weekStart,weekEnd,shiftMonthAnchor,shiftYearAnchor};
})();
