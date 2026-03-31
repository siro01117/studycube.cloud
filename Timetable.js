const { useState, useMemo, useEffect, useRef } = React;

// [1. 시스템 환경 설정]
const SUPABASE_URL = 'https://ovnabmmofgujgefuamzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Sr-c62OzsZHne3xYwFuymw_qCz3fhy9'; // 제공해주신 anon 키

const START_HOUR = 7;
const END_HOUR = 24;
const SLOT_HEIGHT = 80;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DEFAULT_TAGS = ['자습', '인강', '외부 학원', '수업', '상담'];
const DEFAULT_COLORS = ['#ff7675', '#74b9ff', '#55efc4', '#ffeaa7', '#a29bfe', '#dfe6e9'];

const App = () => {
    // [2. 시스템 상태 관리]
    const [isAuth, setIsAuth] = useState(false); // Auth.js에서 제어
    const [dbClient, setDbClient] = useState(null);
    const [students, setStudents] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [trashMode, setTrashMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [filterTitle, setFilterTitle] = useState('');
    const [filterTag, setFilterTag] = useState('');
    
    const [customTags, setCustomTags] = useState(DEFAULT_TAGS);
    const [customColors, setCustomColors] = useState(DEFAULT_COLORS);
    const [dragItem, setDragItem] = useState(null);

    const [studentModal, setStudentModal] = useState({ open: false, id: null, name: '' });
    const [scheduleModal, setScheduleModal] = useState({ open: false, id: null });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });
    const [sForm, setSForm] = useState({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: [], color: DEFAULT_COLORS[0], memo: '' });
    
    const captureRef = useRef(null);

    // [3. 클라우드 DB 연동 엔진]
    useEffect(() => {
        if (isAuth && window.supabase) {
            const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            setDbClient(client);
            fetchDB(client);
        }
    }, [isAuth]);

    const fetchDB = async (client) => {
        const { data, error } = await client.from('schedules').select('*');
        if (data) {
            setStudents(data.map(row => ({
                id: row.id, 
                name: row.student_name, 
                schedules: row.data?.schedules || [], 
                isDeleted: row.data?.isDeleted || false
            })));
        }
    };

    const syncToDB = async (updatedStudents, targetStudent) => {
        setStudents(updatedStudents);
        if (dbClient && targetStudent) {
            await dbClient.from('schedules').upsert({
                id: targetStudent.id,
                student_name: targetStudent.name,
                data: { schedules: targetStudent.schedules, isDeleted: targetStudent.isDeleted },
                updated_at: new Date()
            });
        }
    };

    // [4. 데이터 연산 및 헬퍼]
    const current = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);
    
    const { filteredSchedules, stats } = useMemo(() => {
        if (!current) return { filteredSchedules: [], stats: { total: 0, avg: 0 } };
        const filtered = current.schedules.filter(s => s.title.includes(filterTitle) && (filterTag === '' || s.tags.includes(filterTag)));
        let totalMin = 0;
        filtered.forEach(s => {
            const dur = (parseInt(s.endH)*60 + parseInt(s.endM)) - (parseInt(s.startH)*60 + parseInt(s.startM));
            totalMin += dur * s.days.length;
        });
        return { filteredSchedules: filtered, stats: { total: totalMin, avg: Math.floor(totalMin / 7) } };
    }, [current, filterTitle, filterTag]);

    const formatMinToTime = (min) => `${Math.floor(min/60).toString().padStart(2,'0')}h ${(min%60).toString().padStart(2,'0')}m`;

    const getRect = (s) => {
        const start = (parseInt(s.startH)*60 + parseInt(s.startM)) - (START_HOUR * 60);
        const dur = (parseInt(s.endH)*60 + parseInt(s.endM)) - (parseInt(s.startH)*60 + parseInt(s.startM));
        return { top: `${(start/60)*SLOT_HEIGHT}px`, height: `${(dur/60)*SLOT_HEIGHT}px`, backgroundColor: s.color };
    };

    // [5. 시스템 메서드]
    const saveStudent = () => {
        if (!studentModal.name.trim()) return;
        let newOrUpdated;
        let nextStudents;
        if (studentModal.id) {
            newOrUpdated = { ...students.find(s => s.id === studentModal.id), name: studentModal.name };
            nextStudents = students.map(s => s.id === studentModal.id ? newOrUpdated : s);
        } else {
            newOrUpdated = { id: Date.now(), name: studentModal.name, schedules: [], isDeleted: false };
            nextStudents = [...students, newOrUpdated];
        }
        syncToDB(nextStudents, newOrUpdated);
        setStudentModal({ open: false, id: null, name: '' });
    };

    const handleStudentAction = (id, action) => {
        const target = students.find(s => s.id === id);
        if (!target) return;
        let updatedTarget = { ...target };
        if (action === 'delete') updatedTarget.isDeleted = true;
        if (action === 'restore') updatedTarget.isDeleted = false;
        
        if (action === 'hardDelete') {
            const nextStudents = students.filter(s => s.id !== id);
            setStudents(nextStudents);
            if (dbClient) dbClient.from('schedules').delete().eq('id', id).then();
            if (selectedId === id) setSelectedId(null);
        } else {
            const nextStudents = students.map(s => s.id === id ? updatedTarget : s);
            syncToDB(nextStudents, updatedTarget);
        }
    };

    const saveSchedule = () => {
        if (!sForm.title || sForm.days.length === 0) return alert('제목과 요일을 지정하십시오.');
        const start = parseInt(sForm.startH)*60 + parseInt(sForm.startM);
        const end = parseInt(sForm.endH)*60 + parseInt(sForm.endM);
        if (end <= start) return alert('종료 시간 연산 오류');

        const newSch = { ...sForm, id: scheduleModal.id || Date.now() };
        const updatedSchList = scheduleModal.id ? current.schedules.map(s => s.id === scheduleModal.id ? newSch : s) : [...current.schedules, newSch];
        const updatedStudent = { ...current, schedules: updatedSchList };
        
        syncToDB(students.map(s => s.id === selectedId ? updatedStudent : s), updatedStudent);
        setScheduleModal({ open: false, id: null });
    };

    // [6. 출력 엔진]
    const handleExport = (format) => {
        if (window.ExportSystem && captureRef.current) {
            window.ExportSystem.generate(captureRef.current, current.name, format);
        }
    };

    // [7. 보안 게이트웨이 호출 (Auth.js 연동)]
    if (!isAuth) {
        // window.AuthSystem이 정의되어 있어야 합니다.
        return window.AuthSystem ? window.AuthSystem.renderGate(setIsAuth) : <div className="p-10 font-black">Auth Module Loading...</div>;
    }

    return (
        <div className="flex h-screen w-full bg-slate-100 font-sans overflow-hidden">
            {/* 사이드바 */}
            <aside className="w-72 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm no-print">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h1 className="text-xl font-bold tracking-tight text-slate-800">STUDY CUBE</h1>
                    <button onClick={() => setTrashMode(!trashMode)} className={`text-sm font-bold px-3 py-1 rounded ${trashMode ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{trashMode ? '휴지통' : '목록'}</button>
                </div>
                <div className="p-4 border-b border-slate-100">
                    {!trashMode && <button onClick={() => setStudentModal({open:true, id:null, name:''})} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg">학생 등록</button>}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {students.filter(s => s.isDeleted === trashMode).map(s => (
                        <div key={s.id} onClick={() => !trashMode && setSelectedId(s.id)} className={`group p-4 rounded-xl border-2 flex justify-between items-center cursor-pointer transition-all ${selectedId === s.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}>
                            <span className="font-bold text-slate-700 truncate mr-2">{s.name}</span>
                            <div className="hidden group-hover:flex gap-1 shrink-0">
                                {!trashMode ? (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); setStudentModal({open:true, id:s.id, name:s.name}); }} className="p-1 bg-slate-200 rounded hover:bg-slate-300 transition-colors"><lucide.icons.Edit2 size={12}/></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleStudentAction(s.id, 'delete'); }} className="p-1 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"><lucide.icons.Trash2 size={12}/></button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => handleStudentAction(s.id, 'restore')} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"><lucide.icons.RotateCcw size={12}/></button>
                                        <button onClick={() => handleStudentAction(s.id, 'hardDelete')} className="p-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"><lucide.icons.X size={12}/></button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* 메인 화면 */}
            <main className="flex-1 flex flex-col bg-slate-50 relative">
                {current ? (
                    <>
                        <header className="h-20 bg-white border-b px-8 flex items-center justify-between z-10 no-print">
                            <h2 className="text-xl font-black text-slate-800">{current.name} 시간표 시스템</h2>
                            <div className="flex gap-3">
                                {!isEditMode && (
                                    <>
                                        <button onClick={() => handleExport('png')} className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-bold text-sm shadow-md hover:brightness-110 active:scale-95 transition-all">PNG</button>
                                        <button onClick={() => handleExport('pdf')} className="px-4 py-2 bg-indigo-500 text-white rounded-lg font-bold text-sm shadow-md hover:brightness-110 active:scale-95 transition-all">PDF</button>
                                    </>
                                )}
                                <button onClick={() => setIsEditMode(!isEditMode)} className={`px-6 py-2 rounded-lg font-bold text-sm text-white shadow-md active:scale-95 transition-all ${isEditMode ? 'bg-slate-800' : 'bg-blue-600'}`}>
                                    {isEditMode ? '편집 완료' : '시간표 편집'}
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 flex overflow-hidden p-6 gap-6">
                            {/* 좌측 리스트/필터 */}
                            <div className="w-80 flex flex-col gap-4 no-print">
                                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                    <div className="mb-6 space-y-2">
                                        <input type="text" placeholder="제목 검색" value={filterTitle} onChange={e => setFilterTitle(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none border-2 border-transparent focus:border-blue-400 transition-all" />
                                        <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none border-2 border-transparent focus:border-blue-400 transition-all">
                                            <option value="">전체 태그</option>
                                            {customTags.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-2 border-t pt-4">
                                        <div className="flex justify-between items-end">
                                            <span className="text-xs font-bold text-slate-400 uppercase">Weekly Total</span>
                                            <span className="text-xl font-black text-blue-600 tabular-nums">{formatMinToTime(stats.total)}</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <span className="text-xs font-bold text-slate-400 uppercase">Daily Avg</span>
                                            <span className="text-lg font-black text-slate-700 tabular-nums">{formatMinToTime(stats.avg)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                    <h3 className="text-xs font-black text-slate-400 mb-2 uppercase tracking-widest">Schedule List</h3>
                                    {filteredSchedules.map(s => (
                                        <div key={s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full shadow-sm" style={{backgroundColor: s.color}}></div>
                                                <span className="font-bold text-sm truncate text-slate-800">{s.title}</span>
                                            </div>
                                            <span className="text-[11px] text-slate-500 font-bold">{s.days.join(', ')} | {s.startH}:{s.startM} - {s.endH}:{s.endM}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 우측 시간표 그리드 */}
                            <div className="flex-1 overflow-auto bg-slate-200 p-8 rounded-2xl shadow-inner relative flex justify-center custom-scrollbar">
                                <div ref={captureRef} className="export-area bg-white shadow-lg relative w-[1000px] min-w-[1000px] h-fit p-10 box-border rounded-xl font-sans">
                                    <div className="mb-8 flex justify-between items-end border-b-4 border-slate-900 pb-6">
                                        <h1 className="text-3xl font-black uppercase tracking-widest text-slate-900 italic">{current.name} 주간 계획표</h1>
                                        <div className="flex gap-6 text-right font-sans">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Weekly Total</span>
                                                <span className="text-2xl font-black text-blue-600 tabular-nums leading-none">{formatMinToTime(stats.total)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Daily Avg</span>
                                                <span className="text-2xl font-black text-slate-800 tabular-nums leading-none">{formatMinToTime(stats.avg)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex border-2 border-slate-800 rounded-xl overflow-hidden bg-white grid-layout">
                                        <div className="w-16 bg-slate-50 border-r-2 border-slate-800 flex flex-col text-center shrink-0">
                                            <div className="h-12 border-b-2 border-slate-800"></div>
                                            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                <div key={i} className="flex items-center justify-center text-[10px] font-black text-slate-300 border-b border-slate-100 relative shrink-0" style={{height: `${SLOT_HEIGHT}px`}}>
                                                    <span className="absolute top-[-7px] bg-slate-50 px-1">{START_HOUR + i}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} className="flex-1 flex flex-col relative border-r border-slate-200 last:border-r-0">
                                                <div className="h-12 border-b-2 border-slate-800 flex items-center justify-center font-black text-slate-800 text-sm">{day}</div>
                                                <div className="flex-1 relative bg-white">
                                                    {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                        <div key={i} className="border-b border-slate-50 shrink-0" style={{height: `${SLOT_HEIGHT}px`}}></div>
                                                    ))}
                                                    {filteredSchedules.filter(s => s.days.includes(day)).map(s => {
                                                        const durMin = (parseInt(s.endH) * 60 + parseInt(s.endM)) - (parseInt(s.startH) * 60 + parseInt(s.startM));
                                                        return (
                                                            <div key={s.id} onClick={() => isEditMode ? setScheduleModal({open:true, id:s.id}) : setDetailModal({open:true, item:s})}
                                                                className={`absolute left-[2px] right-[2px] p-2 rounded-lg shadow-md border border-black/5 flex flex-col overflow-hidden cursor-pointer transition-all hover:scale-[1.02] hover:z-10 ${isEditMode ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                                                                style={getRect(s)}>
                                                                <span className="font-black text-[12px] text-slate-900 leading-tight truncate">{s.title}</span>
                                                                <span className="text-[9px] font-bold text-slate-800/50 mt-0.5">{s.startH}:{s.startM}</span>
                                                                {durMin >= 45 && s.tags && s.tags.length > 0 && (
                                                                    <div className="mt-auto flex flex-wrap gap-1 overflow-hidden max-h-[14px]">
                                                                        {s.tags.map(t => <span key={t} className="text-[8px] font-black bg-white/50 px-1 rounded truncate text-slate-800">#{t}</span>)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {isEditMode && (
                            <button onClick={() => { setSForm({title:'', days:[], startH:'09', startM:'00', endH:'10', endM:'00', tags:[], color:customColors[0], memo:''}); setScheduleModal({open:true, id:null}); }} 
                                className="absolute bottom-10 right-10 w-16 h-16 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center text-4xl font-light hover:bg-blue-700 active:scale-90 hover:rotate-90 transition-all z-30">+</button>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300 font-black text-2xl tracking-[0.5em] uppercase opacity-20">
                        <lucide.icons.Layout size={100} className="mb-6" />
                        Select Student Identity
                    </div>
                )}
            </main>

            {/* [모달 1: 일정 폼] */}
            {scheduleModal.open && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                    <div className="bg-white rounded-[3rem] w-[650px] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200">
                        <div className="h-6 w-full" style={{backgroundColor: sForm.color}}></div>
                        <div className="p-10 space-y-8">
                            <input type="text" placeholder="일정 제목 입력" value={sForm.title} onChange={e=>setSForm({...sForm, title:e.target.value})} className="w-full text-4xl font-black border-b-4 border-slate-100 pb-4 outline-none focus:border-blue-500 transition-all" />
                            <div>
                                <label className="text-xs font-black text-slate-400 mb-3 block uppercase tracking-widest">Select Days</label>
                                <div className="flex gap-2">
                                    {DAYS.map(d => (
                                        <button key={d} onClick={() => setSForm({...sForm, days: sForm.days.includes(d) ? sForm.days.filter(x=>x!==d) : [...sForm.days, d]})}
                                                className={`flex-1 py-3 rounded-xl font-bold transition-all ${sForm.days.includes(d) ? 'bg-slate-900 text-white scale-105 shadow-lg' : 'bg-slate-50 text-slate-400'}`}>{d}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-8">
                                <div>
                                    <label className="text-xs font-black text-slate-400 mb-3 block uppercase tracking-widest">Start Time</label>
                                    <div className="flex gap-2"><input type="text" maxLength="2" value={sForm.startH} onChange={e=>setSForm({...sForm, startH:e.target.value})} className="w-full bg-slate-50 p-4 rounded-2xl text-center font-black text-xl outline-none focus:ring-2 focus:ring-blue-500" /> <span className="flex items-center font-black text-slate-200">:</span> <input type="text" maxLength="2" value={sForm.startM} onChange={e=>setSForm({...sForm, startM:e.target.value})} className="w-full bg-slate-50 p-4 rounded-2xl text-center font-black text-xl outline-none focus:ring-2 focus:ring-blue-500" /></div>
                                </div>
                                <div>
                                    <label className="text-xs font-black text-slate-400 mb-3 block uppercase tracking-widest">End Time</label>
                                    <div className="flex gap-2"><input type="text" maxLength="2" value={sForm.endH} onChange={e=>setSForm({...sForm, endH:e.target.value})} className="w-full bg-slate-50 p-4 rounded-2xl text-center font-black text-xl outline-none focus:ring-2 focus:ring-blue-500" /> <span className="flex items-center font-black text-slate-200">:</span> <input type="text" maxLength="2" value={sForm.endM} onChange={e=>setSForm({...sForm, endM:e.target.value})} className="w-full bg-slate-50 p-4 rounded-2xl text-center font-black text-xl outline-none focus:ring-2 focus:ring-blue-500" /></div>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 mb-3 flex justify-between uppercase tracking-widest"><span>Tags</span> <div onDragOver={e=>e.preventDefault()} onDrop={() => { if(dragItem?.type === 'tag') setCustomTags(customTags.filter(t=>t!==dragItem.val)); setDragItem(null); }} className="text-red-500 bg-red-50 px-2 py-1 rounded-lg text-[9px] font-black border border-red-100 flex items-center gap-1">🗑️ DROP TO DELETE</div></label>
                                <div className="flex flex-wrap gap-2 items-center bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100">
                                    {customTags.map(t => (
                                        <button key={t} draggable onDragStart={()=>setDragItem({type:'tag', val:t})} onClick={() => setSForm({...sForm, tags: sForm.tags.includes(t) ? sForm.tags.filter(x=>x!==t) : [...sForm.tags, t]})}
                                                className={`px-4 py-2 rounded-full text-xs font-black transition-all cursor-grab active:cursor-grabbing ${sForm.tags.includes(t) ? 'bg-blue-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'}`}>#{t}</button>
                                    ))}
                                    <input type="text" placeholder="+ Add" onKeyDown={(e) => { if(e.key==='Enter' && e.target.value) { setCustomTags([...new Set([...customTags, e.target.value])]); e.target.value=''; } }} className="bg-transparent text-xs font-black outline-none w-20 px-2" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 mb-3 flex justify-between uppercase tracking-widest"><span>Theme Color</span> <div onDragOver={e=>e.preventDefault()} onDrop={() => { if(dragItem?.type === 'color') setCustomColors(customColors.filter(c=>c!==dragItem.val)); setDragItem(null); }} className="text-red-500 bg-red-50 px-2 py-1 rounded-lg text-[9px] font-black border border-red-100 flex items-center gap-1">🗑️ DROP TO DELETE</div></label>
                                <div className="flex flex-wrap gap-4 bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100 items-center">
                                    {customColors.map(c => (
                                        <div key={c} draggable onDragStart={()=>setDragItem({type:'color', val:c})} onClick={() => setSForm({...sForm, color: c})} className={`w-8 h-8 rounded-full cursor-grab shadow-sm transition-all ${sForm.color === c ? 'ring-4 ring-offset-2 ring-slate-800 scale-110' : 'hover:scale-110'}`} style={{backgroundColor: c}}></div>
                                    ))}
                                    <input type="color" className="w-8 h-8 border-0 cursor-pointer p-0 bg-transparent" onBlur={(e) => setCustomColors([...new Set([...customColors, e.target.value])]) } title="새 색상 추가" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 mb-3 block uppercase tracking-widest">Memo</label>
                                <textarea value={sForm.memo} onChange={e=>setSForm({...sForm, memo:e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-2xl p-5 text-sm font-bold resize-none h-28 outline-none transition-all"></textarea>
                            </div>
                        </div>
                        <div className="flex p-6 bg-slate-50 gap-4">
                            <button onClick={()=>setScheduleModal({open:false, id:null})} className="flex-1 py-5 font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest">Cancel</button>
                            <button onClick={saveSchedule} className="flex-[2] py-5 font-black text-white bg-blue-600 rounded-2xl hover:bg-blue-700 shadow-xl active:scale-95 transition-all uppercase tracking-widest">Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* [모달 2: 상세 뷰어] */}
            {detailModal.open && detailModal.item && (
                <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-300" onClick={()=>setDetailModal({open:false, item:null})}>
                    <div className="bg-white rounded-[3.5rem] p-12 max-w-md w-full shadow-2xl transform animate-in zoom-in duration-200" onClick={e=>e.stopPropagation()}>
                        <div className="flex gap-2 mb-6">
                            {detailModal.item.tags.map(t => <span key={t} className="text-[10px] font-black bg-blue-50 text-blue-600 px-3 py-1 rounded-full uppercase tracking-tighter">#{t}</span>)}
                        </div>
                        <h3 className="text-4xl font-black text-slate-900 mb-3 tracking-tighter">{detailModal.item.title}</h3>
                        <p className="text-sm font-black text-slate-400 mb-8 uppercase italic">{detailModal.item.days.join(', ')} | {detailModal.item.startH}:{detailModal.item.startM} - {detailModal.item.endH}:{detailModal.item.endM}</p>
                        <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 min-h-[150px] text-base font-bold text-slate-600 whitespace-pre-wrap leading-relaxed shadow-inner">
                            {detailModal.item.memo || '작성된 메모가 없습니다.'}
                        </div>
                        <div className="flex gap-4 mt-10">
                            <button onClick={() => {
                                setSForm(detailModal.item); 
                                setDetailModal({open:false, item:null}); 
                                setIsEditMode(true); 
                                setScheduleModal({open:true, id:detailModal.item.id});
                            }} className="flex-1 py-5 bg-blue-100 text-blue-700 font-black rounded-2xl hover:bg-blue-200 transition-all active:scale-95 uppercase tracking-widest">Edit</button>
                            <button onClick={()=>setDetailModal({open:false, item:null})} className="flex-1 py-5 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-800 transition-all active:scale-95 uppercase tracking-widest">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* [모달 3: 학생 폼] */}
            {studentModal.open && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl flex items-center justify-center z-[500] animate-in fade-in duration-300">
                    <div className="bg-white p-16 rounded-[4rem] w-full max-w-lg shadow-2xl text-center transform animate-in zoom-in duration-200">
                        <h3 className="text-3xl font-black mb-10 italic uppercase text-slate-800 tracking-tighter">{studentModal.id ? 'Edit Identity' : 'New Identity'}</h3>
                        <input type="text" value={studentModal.name} onChange={e=>setStudentModal({...studentModal, name:e.target.value})} className="w-full border-b-8 border-slate-50 p-6 rounded-3xl text-center text-4xl font-black mb-12 bg-slate-50 outline-none focus:border-blue-500 transition-all placeholder:text-slate-200" autoFocus onKeyDown={e=>e.key==='Enter'&&saveStudent()} placeholder="이름 입력" />
                        <div className="flex gap-4"><button onClick={()=>setStudentModal({open:false, id:null, name:''})} className="flex-1 py-6 bg-slate-100 rounded-3xl font-black text-slate-400 uppercase tracking-widest hover:bg-slate-200 transition-all">Cancel</button><button onClick={saveStudent} className="flex-[2] py-6 bg-blue-600 text-white rounded-3xl font-black text-xl shadow-xl hover:bg-blue-700 active:scale-95 transition-all uppercase tracking-widest">Confirm</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
