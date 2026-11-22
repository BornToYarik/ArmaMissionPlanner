export function shotWindow(now,born,duration,paused,tail=.075){
 const age=(now-born)/1000;if(age<0||age>duration+.35)return null;
 const end=paused?duration:Math.max(0,Math.min(duration,age)),start=paused?0:Math.max(0,end-tail);
 return {start,end,fade:age<=duration?1:Math.max(0,1-(age-duration)/.35),flash:age>=0&&age<.06};
}
