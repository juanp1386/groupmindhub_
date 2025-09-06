// state.js - load/save + seed
const LS_KEY = 'gmh_state_v1';
export function seedInitial(){
  return {
    users:[
      {id:'u1',name:'Ana'},{id:'u2',name:'Ben'},{id:'u3',name:'Chen'},{id:'u4',name:'Devi'},{id:'u5',name:'Eli'}
    ],
    entry:{ id:'e1', title:'Trunk v1', version:1, votes:12, blocks:[
      { id:'h_purpose', type:'h2', text:'Purpose', parent:null },
      { id:'p_purpose', type:'p', text:'These bylaws guide the operation of the Willow Creek Community Garden and ensure fair access, safety, and shared stewardship.', parent:'h_purpose' },
      { id:'h_meet', type:'h2', text:'Meetings', parent:null },
      { id:'p_meet', type:'p', text:'The HOA meets monthly on the first Saturday at 10:00 AM at the tool shed. Minutes are posted to the bulletin board within 7 days.', parent:'h_meet' },
      { id:'h_quorum', type:'h2', text:'Quorum', parent:null },
      { id:'p_quorum', type:'p', text:'Quorum is established when at least 25% of plot holders are present. Votes pass with a simple majority of those present.', parent:'h_quorum' },
      { id:'h_maint', type:'h2', text:'Plot Maintenance', parent:null },
      { id:'p_maint', type:'p', text:'Gardeners must weed, water, and maintain plots weekly. Neglected plots may be reassigned after two warnings.', parent:'h_maint' },
      { id:'h_tools', type:'h2', text:'Tools & Safety', parent:null },
      { id:'p_tools', type:'p', text:'Common tools are shared on a first-come basis. Return tools clean. Children must be supervised at all times.', parent:'h_tools' }
    ]},
    patches:[],
  };
}
export function loadState(){
  try{ const raw = localStorage.getItem(LS_KEY); if(!raw) return seedInitial(); const parsed = JSON.parse(raw); return parsed; }catch{ return seedInitial(); }
}
export function saveState(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify({ users:s.users, entry:s.entry, patches:s.patches })); }catch(e){ console.warn('saveState failed', e); }}
export function resetState(){ localStorage.removeItem(LS_KEY); }
