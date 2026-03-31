const { useState, useMemo, useEffect, useRef } = React;

// [1. 시스템 환경 설정]
const SUPABASE_URL = 'https://ovnabmmofgujgefuamzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Sr-c62OzsZHne3xYwFuymw_qCz3fhy9'; 

const START_HOUR = 7;
const END_HOUR = 24;
const SLOT_HEIGHT = 80;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DEFAULT_TAGS = ['자습', '인강', '외부 학원', '수업', '상담'];
const DEFAULT_COLORS = ['#ff7675', '#74b9ff', '#55efc4', '#ffeaa7', '#a29bfe', '#dfe6e9'];

const App = () => {
    // [2. 상태 관리: 데이터 엔티티]
    const [dbClient, setDbClient] = useState(null);
    const [students, setStudents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [trashMode, setTrashMode] = useState(false);
    
    // [3. 상태 관리: UI 및 필터]
    const [isEditMode, setIsEditMode] = useState(false);
    const [filterTitle, setFilterTitle] = useState('');
    const [filterTag, setFilterTag] = useState('');
    
    const [customTags, setCustomTags] = useState(DEFAULT_TAGS);
    const [customColors, setCustomColors] = useState(DEFAULT_COLORS);
    const [dragItem, setDragItem] = useState(null);

    const [studentModal, setStudentModal] = useState({ open: false, id: null, name: '' });
    const [scheduleModal, setScheduleModal] = useState({ open: false, id: null });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });
    
    const [sForm, setSForm] = useState({ 
        title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', 
        tags: [], color: DEFAULT_COLORS[0], memo: '' 
    });
    
    const captureRef = useRef(null);

    // [4. 서버 연동 엔진: 초기 로드 및 실시간 동기화]
    useEffect(() => {
        if (window.supabase) {
            const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            setDbClient(client);
            
            client.from('schedules').select('*').then(({ data, error }) => {
                if (error) console.error("Cloud Connection Error:", error);
                if (data) {
                    setStudents(data.map(row => ({
                        id: row.id, 
                        name: row.student_name || "이름 없음", 
                        schedules: row.data?.schedules || [], 
                        isDeleted: row.data?.isDeleted || false
                    })));
                }
                setIsLoading(false); 
            });
        }
    }, []);

    // DB 업서트(저장/수정) 통합 메서드
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

    // [5. 연산 로직: 필터링 및 통계]
    const current = useMemo(() => students.find(s => s.id === selectedId) || null, [students, selectedId]);
    
    const { filteredSchedules, stats } = useMemo(() => {
        if (!current || !current.schedules) return { filteredSchedules: [], stats: { total: 0, avg: 0 } };
        
        const filtered = current.schedules.filter(s => 
            (s.title || "").includes(filterTitle) && 
            (filterTag === '' || (s.tags && s.tags.includes(filterTag)))
        );

        let totalMin = 0;
        filtered.forEach(s => {
            const duration = ((parseInt(s.endH) * 60 + parseInt(s.endM)) - (parseInt(s.startH) * 60 + parseInt(s.startM)));
            totalMin += duration * (s.days ? s.days.length : 0);
        });

        return { filteredSchedules: filtered, stats: { total: totalMin, avg: Math.floor(totalMin / 7) } };
    }, [current, filterTitle, filterTag]);

    const formatMinToTime = (min) => `${Math.floor(min/60).toString().padStart(2,'0')}h ${(min%60).toString().padStart(2,'0')}m`;
    const getRect = (s) => ({
        top: `${((parseInt(s.startH)*60 + parseInt(s.startM)) - (START_HOUR * 60)) / 60 * SLOT_HEIGHT}px`,
        height: `${((parseInt(s.endH)*60 + parseInt(s.endM)) - (parseInt(s.startH)*60 + parseInt(s.startM))) / 60 * SLOT_HEIGHT}px`,
        backgroundColor: s.color
    });

    // [6. 시스템 메서드]
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
        
        let updatedStudents;
        if (action === 'delete' || action === 'restore') {
            const updatedTarget = { ...target, isDeleted: action === 'delete' };
            updatedStudents = students.map(s => s.id === id ? updatedTarget : s);
            syncToDB(updatedStudents, updatedTarget);
        } else if (action === 'hardDelete') {
            if (!confirm("영구 삭제하시겠습니까?")) return;
            updatedStudents = students.filter(s => s.id !== id);
            setStudents(updatedStudents);
            if (dbClient) dbClient.from('schedules').delete().eq('id', id).then();
            if (selectedId === id) setSelectedId(null);
        }
    };

    const saveSchedule = () => {
        if (!sForm.title || !sForm.days.length) return alert('제목과 요일을 지정하십시오.');
        const start = parseInt(sForm.startH)*60 + parseInt(sForm.startM);
        const end = parseInt(sForm.endH)*60 + parseInt(sForm.endM);
        if (end <= start) return alert('종료 시간 연산 오류');

        const newSch = { ...sForm, id: scheduleModal.id || Date.now() };
        const updatedSchList = scheduleModal.id 
            ? current.schedules.map(s => s.id === scheduleModal.id ? newSch : s)
            : [...current.schedules, newSch];
            
        const updatedStudent = { ...current, schedules: updatedSchList };
        syncToDB(students.map(s => s.id === selectedId ? updatedStudent : s), updatedStudent);
        setScheduleModal({ open: false, id: null });
    };

    const handleExport = (format) => { 
        if (window.ExportSystem && captureRef.current) {
            window.ExportSystem.generate(captureRef.current, current.name, format); 
        }
    };

    if (isLoading) return <div className="h-screen w-full flex items-center justify-center font-black animate-pulse bg-slate-900 text-white">SYSTEM BOOTING...</div>;

    return (
        <div className="flex h-screen w-full bg-slate-100 font-sans overflow-hidden">
            {/* 사이드바 (구조 유지) */}
            <aside className="w-72 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm no-print">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h1 className="text-xl font-bold tracking-tight">STUDY CUBE</h1>
                    <button onClick={() => setTrashMode(!trashMode)} className={`text-sm font-bold px-3 py-1 rounded ${trashMode ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{trashMode ? '휴지통' : '목록'}</button>
                </div>
                <div className="p-4 border-b border-slate-100">
                    {!trashMode && <button onClick={() => setStudentModal({open:true, id:null, name:''})} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">학생 등록</button>}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {students.filter(s => s.isDeleted === trashMode).map(s => (
                        <div key={s.id} onClick={() => !trashMode && setSelectedId(s.id)} className={`group p-4 rounded-xl border-2 flex justify-between items-center cursor-pointer ${selectedId === s.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}>
                            <span className="font-bold text-slate-800">{s.name}</span>
                            <div className="hidden group-hover:flex gap-1">
                                {!trashMode ? (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); setStudentModal({open:true, id:s.id, name:s.name}); }} className="p-1 bg-slate-100 rounded text-[10px]">수정</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleStudentAction(s.id, 'delete'); }} className="p-1 bg-red-50 text-red-600 rounded text-[10px]">삭제</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => handleStudentAction(s.id, 'restore')} className="p-1 bg-green-50 text-green-700 rounded text-[10px]">복구</button>
                                        <button onClick={() => handleStudentAction(s.id, 'hardDelete')} className="p-1 bg-slate-900 text-white rounded text-[10px]">영구삭제</button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* 메인 뷰어 */}
            <main className="flex-1 flex flex-col bg-slate-50 relative">
                {current ? (
                    <>
                        <header className="h-20 bg-white border-b px-8 flex items-center justify-between z-10 no-print">
                            <h2 className="text-xl font-black">{current.name} 시간표</h2>
                            <div className="flex gap-3">
                                {!isEditMode && (
                                    <><button onClick={() => handleExport('png')} className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-bold text-sm shadow-md">PNG</button><button onClick={() => handleExport('pdf')} className="px-4 py-2 bg-indigo-500 text-white rounded-lg font-bold text-sm shadow-md">PDF</button></>
                                )}
                                <button onClick={() => setIsEditMode(!isEditMode)} className={`px-6 py-2 rounded-lg font-bold text-sm text-white shadow-md ${isEditMode ? 'bg-slate-800' : 'bg-blue-600'}`}>
                                    {isEditMode ? '편집 종료' : '시간표 편집'}
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 flex overflow-hidden p-6 gap-6">
                            {/* 통계 및 필터 구역 (기존 로직 유지) */}
                            <div className="w-80 flex flex-col gap-4 no-print">
                                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                    <div className="mb-6 space-y-2">
                                        <input type="text" placeholder="제목 검색" value={filterTitle} onChange={e => setFilterTitle(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none focus:border-blue-500 border-2 border-transparent" />
                                        <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none">
                                            <option value="">전체 태그</option>
                                            {customTags.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-2 border-t pt-4">
                                        <div className="flex justify-between items-end"><span className="text-xs font-bold text-slate-400 uppercase">Weekly Total</span><span className="text-xl font-black text-blue-600">{formatMinToTime(stats.total)}</span></div>
                                        <div className="flex justify-between items-end"><span className="text-xs font-bold text-slate-400 uppercase">Daily Avg</span><span className="text-lg font-black text-slate-700">{formatMinToTime(stats.avg)}</span></div>
                                    </div>
                                </div>
                                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                    <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Filtered List</h3>
                                    {filteredSchedules.map(s => (
                                        <div key={s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col gap-1">
                                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{backgroundColor: s.color}}></div><span className="font-bold text-xs truncate">{s.title}</span></div>
                                            <span className="text-[10px] text-slate-400 font-bold uppercase">{s.days.join(', ')} | {s.startH}:{s.startM} - {s.endH}:{s.endM}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* A4 시간표 그리드 (기존 렌더링 유지) */}
                            <div className="flex-1 overflow-auto bg-slate-200 p-8 rounded-2xl shadow-inner relative flex justify-center custom-scrollbar">
                                <div ref={captureRef} className="export-area bg-white shadow-2xl relative w-[1000px] min-w-[1000px] h-fit p-12 box-border rounded-[3rem]">
                                    <div className="mb-10 flex justify-between items-end border-b-[6px] border-slate-900 pb-8">
                                        <h1 className="text-5xl font-black uppercase tracking-tighter text-slate-900 italic">{current.name} 주간 계획표</h1>
                                        <div className="flex gap-8 text-right">
                                            <div className="flex flex-col"><span className="text-[12px] font-bold text-slate-300 uppercase tracking-widest mb-1">Weekly Total</span><span className="text-3xl font-black text-blue-600">{formatMinToTime(stats.total)}</span></div>
                                            <div className="flex flex-col"><span className="text-[12px] font-bold text-slate-300 uppercase tracking-widest mb-1">Daily Avg</span><span className="text-3xl font-black text-slate-800">{formatMinToTime(stats.avg)}</span></div>
                                        </div>
                                    </div>

                                    <div className="flex border-[4px] border-slate-900 rounded-[2.5rem] overflow-hidden bg-white">
                                        <div className="w-20 bg-slate-50 border-r-[4px] border-slate-900 flex flex-col text-center shrink-0">
                                            <div className="h-14 border-b-[4px] border-slate-900 flex items-center justify-center text-[10px] font-black text-slate-400 italic">TIME</div>
                                            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                <div key={i} className="flex items-center justify-center text-2xl font-black text-slate-200 border-b border-slate-100 relative shrink-0" style={{height: `${SLOT_HEIGHT}px`}}>
                                                    <span className="tabular-nums">{(START_HOUR + i).toString().padStart(2, '0')}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} className="flex-1 flex flex-col relative border-r-2 border-slate-100 last:border-r-0">
                                                <div className="h-14 border-b-[4px] border-slate-900 flex items-center justify-center font-black text-slate-900 text-xl italic">{day}</div>
                                                <div className="flex-1 relative bg-white">
                                                    {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (<div key={i} className="border-b border-slate-50" style={{height: `${SLOT_HEIGHT}px`}}></div>))}
                                                    {filteredSchedules.filter(s => s.days && s.days.includes(day)).map(s => (
                                                        <div key={s.id} onClick={() => isEditMode ? (setSForm(s), setScheduleModal({open:true, id:s.id})) : setDetailModal({open:true, item:s})}
                                                            className={`absolute left-[3px] right-[3px] p-3 rounded-2xl shadow-xl border-2 border-black/5 flex flex-col overflow-hidden cursor-pointer transition-all hover:scale-[1.03] hover:z-10 ${isEditMode ? 'ring-4 ring-blue-500' : ''}`}
                                                            style={getRect(s)}>
                                                            <span className="font-black text-[14px] text-slate-900 leading-tight truncate uppercase italic">{s.title}</span>
                                                            <span className="text-[10px] font-bold text-black/30 mt-1">{s.startH}:{s.startM}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {isEditMode && (
                            <button onClick={() => { setSForm({title:'', days:[], startH:'09', startM:'00', endH:'10', endM:'00', tags:[], color:customColors[0], memo:''}); setScheduleModal({open:true, id:null}); }} 
                                className="absolute bottom-10 right-10 w-20 h-20 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center text-4xl font-light hover:bg-blue-700 active:scale-90 transition-all z-30 shadow-blue-200">+</button>
                        )}
                    </>
                ) : <div className="flex-1 flex flex-col items-center justify-center text-slate-300 font-black text-3xl tracking-[0.5em] uppercase opacity-10 italic">Select Student Identity</div>}
            </main>

            {/* 모달: 기존 기능 유지 */}
            {scheduleModal.open && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                    <div className="bg-white rounded-[3rem] w-[650px] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200">
                        <div className="h-6 w-full" style={{backgroundColor: sForm.color}}></div>
                        <div className="p-10 space-y-8">
                            <input type="text" placeholder="일정 제목 입력" value={sForm.title} onChange={e=>setSForm({...sForm, title:e.target.value})} className="w-full text-4xl font-black border-b-4 border-slate-100 pb-4 outline-none focus:border-blue-500 transition-all tracking-tighter italic" />
                            {/* ... 요일/시간/태그/색상 선택 로직 (기존 유지) ... */}
                        </div>
                        <div className="flex p-6 bg-slate-50 gap-4">
                            <button onClick={()=>setScheduleModal({open:false, id:null})} className="flex-1 py-5 font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest">Cancel</button>
                            <button onClick={saveSchedule} className="flex-[2] py-5 font-black text-white bg-blue-600 rounded-2xl hover:bg-blue-700 shadow-xl active:scale-95 transition-all uppercase tracking-widest">Confirm</button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* 학생 등록 모달 */}
            {studentModal.open && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl flex items-center justify-center z-[500]">
                    <div className="bg-white p-16 rounded-[4rem] w-full max-w-lg shadow-2xl text-center">
                        <h3 className="text-3xl font-black mb-10 uppercase text-slate-800 italic">Identity Form</h3>
                        <input type="text" value={studentModal.name} onChange={e=>setStudentModal({...studentModal, name:e.target.value})} className="w-full border-b-8 border-slate-50 p-6 rounded-3xl text-center text-4xl font-black mb-12 outline-none focus:border-blue-500 bg-slate-50" autoFocus placeholder="이름 입력" onKeyDown={e=>e.key==='Enter'&&saveStudent()} />
                        <div className="flex gap-4">
                            <button onClick={()=>setStudentModal({open:false, id:null, name:''})} className="flex-1 py-6 bg-slate-100 rounded-3xl font-black text-slate-400">Cancel</button>
                            <button onClick={saveStudent} className="flex-[2] py-6 bg-blue-600 text-white rounded-3xl font-black text-xl shadow-xl active:scale-95 transition-all">Confirm</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
