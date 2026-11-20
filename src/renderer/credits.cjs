(async()=>{
  const host=document.getElementById('credits');
  try {
    const entries=await window.starquill.credits();
    for(const [group,members] of Object.entries(Object.groupBy(entries,entry=>entry.group))){
      const section=document.createElement('section'),heading=document.createElement('h3'),list=document.createElement('ul');
      heading.textContent=group;
      for(const entry of members){
        const row=document.createElement('li'),avatar=document.createElement('img'),info=document.createElement('div');
        avatar.alt=entry.name+'头像';
        avatar.onerror=()=>{const fallback=document.createElement('span');fallback.className='credit-initial';fallback.textContent=entry.name[0];avatar.replaceWith(fallback);};
        avatar.src='assets/credits/'+encodeURIComponent(entry.id)+'.png';
        const name=document.createElement('strong'),description=document.createElement('p');
        name.textContent=entry.name;description.textContent=entry.desc;
        info.append(name,description);row.append(avatar,info);
        if(entry.url){
          const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=entry.button;
          button.onclick=()=>window.starquill.openCredit(entry.id).catch(error=>toast(error.message));
          row.append(button);
        }
        list.append(row);
      }
      if(group==='关于'){
        const header=document.createElement('div');
        header.className='credits-header';
        const feedback=document.createElement('button');
        feedback.type='button';
        feedback.className='secondary';
        feedback.textContent='反馈通道';
        feedback.onclick=()=>window.starquill.openFeedback().catch(error=>toast(error.message));
        header.append(heading,feedback);
        section.append(header);
      }else section.append(heading);
      section.append(list);host.append(section);
    }
  }catch(error){host.textContent='无法读取鸣谢表：'+error.message;}
})();
