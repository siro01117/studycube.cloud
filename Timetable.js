const { useState, useMemo, useEffect, useRef } = React;

// [시스템 상수]
const ACCESS_PW = "R040117!"; // 보안 게이트웨이 암호
const SUPABASE_URL = 'https://ovnabmmofgujgefuamzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Sr-c62OzsZHne3xYwFuymw_qCz3fhy9'; // [필수] Supabase API KEY 입력

const START_HOUR = 7;
const END_HOUR = 24;
const SLOT_HEIGHT = 80;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DEFAULT_TAGS = ['자습', '인강', '외부 학원', '수업', '상담'];
const DEFAULT_COLORS = ['#ff7675', '#74b9ff', '#55efc4', '#ffeaa7', '#a29bfe', '#dfe6e9'];

// [모듈 1: 보안 게이트웨이 (내장형)]
const AuthGate = ({ onAuth }) => {
    const [pwd, setPwd] = useState('');
    const verify = () => pwd === ACCESS_PW ? onAuth(true) : alert("보안 인가 실패: 코드가 일치하지 않습니다.");
    return (
        <div className="fixed inset-0 bg-[#1e293b] flex items-center justify-center z-[9999]">
            <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center w-96">
                <h2 className="text-slate-400 font-black tracking-widest text-sm mb-2 uppercase">System Locked</h2>
                <h1 className="text-3xl font-black text-slate-800 mb-8">접근 코드 입력</h1>
                <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&verify()} autoFocus
                    className="w-full border-4 border-slate-100 p-4 rounded-2xl text-center text-2xl font-black mb-6 focus:border-blue-500 outline-none" />
                <button onClick={verify} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-all">UNLOCK SYSTEM</button>
            </div>
        </div>
    );
};

const App = () => {
    // 시스템 런타임 상태
    const [isAuth, setIsAuth] = useState(false);
    const [dbClient, setDbClient] = useState(null);
    const [students, setStudents] = useState([]);
    
    // UI 및 렌더링 상태
    const [selectedId, setSelectedId] = useState(null);
    const [trashMode, setTrashMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [filterTitle, setFilterTitle] = useState('');
    const [filterTag, setFilterTag] = useState('');
    
    const [customTags, setCustomTags] = useState(DEFAULT_TAGS);
    const [customColors, setCustomColors] = useState(DEFAULT_COLORS);
    const [dragItem, setDragItem] = useState(null);

    // 모달 제어
    const [studentModal, setStudentModal] = useState({ open: false, id: null, name: '' });
    const [scheduleModal, setScheduleModal] = useState({ open: false, id: null });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });
    const [sForm, setSForm] = useState({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: [], color: DEFAULT_COLORS[0], memo: '' });
    
    const captureRef = useRef(null);

    // [모듈 2: 클라우드 DB 연동 엔진]
    useEffect(() => {
        if (isAuth && window.supabase) {
            const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            setDbClient(client);
            fetchDB(client);
        }
    }, [isAuth]);

    const fetchDB = async (client) => {
        // 테이블 이름이 'schedules'라고 가정합니다. 필요시 수정.
        const { data, error } = await client.from('schedules').select('*');
        if (data) {
            // DB 구조 매핑 (서버의 JSON 덤프를 로컬 상태로 전환)
            const mappedData = data.map(row => ({
                id: row.id, 
                name: row.student_name, 
                schedules: row.data?.schedules || [], 
                isDeleted: row.data?.isDeleted || false
            }));
            setStudents(mappedData);
        } else if (error) {
            console.error("DB Fetch Error:", error);
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

    // [데이터 연산]
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

    // [시스템 메서드: 학생 CRUD (DB 동기화 결합)]
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
        let updatedTarget = { ...target };
        if (action === 'delete') updatedTarget.isDeleted = true;
        if (action === 'restore') updatedTarget.isDeleted = false;
        
        let nextStudents;
        if (action === 'hardDelete') {
            nextStudents = students.filter(s => s.id !== id);
            // hardDelete는 DB에서 직접 삭제해야 함
            if(dbClient) dbClient.from('schedules').delete().eq('id', id).then();
        } else {
            nextStudents = students.map(s => s.id === id ? updatedTarget : s);
            syncToDB(nextStudents, updatedTarget);
        }
        
        if (action !== 'restore') setStudents(nextStudents);
        if (selectedId === id && action !== 'restore') setSelectedId(null);
    };

    // [시스템 메서드: 일정 블록 연산 (DB 동기화 결합)]
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

    const getRect = (s) => {
        const start = (parseInt(s.startH)*60 + parseInt(s.startM)) - (START_HOUR * 60);
        const dur = (parseInt(s.endH)*60 + parseInt(s.endM)) - (parseInt(s.startH)*60 + parseInt(s.startM));
        return { top: `${(start/60)*SLOT_HEIGHT}px`, height: `${(dur/60)*SLOT_HEIGHT}px`, backgroundColor: s.color };
    };

    // [모듈 3: 서버사이드 모사 출력 엔진 (내장형)]
    const handleExport = async (format) => {
        if (!captureRef.current) return;
        await document.fonts.ready;
        const canvas = await html2canvas(captureRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        
        if (format === 'png') {
            const link = document.createElement('a');
            link.download = `STUDYCUBE_${current.name}.png`;
            link.href = imgData; link.click();
        } else {
            const pdf = new jspdf.jsPDF('p', 'pt', 'a4');
            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`STUDYCUBE_${current.name}.pdf`);
        }
    };

    // 보안 인가 확인
    if (!isAuth) return <AuthGate onAuth={setIsAuth} />;

    return (
        <div className="flex h-screen w-full bg-slate-100 font-sans overflow-hidden">
            {/* [사이드바] */}
            <aside className="w-72 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h1 className="text-xl font-bold tracking-tight">STUDY CUBE</h1>
                    <button onClick={() => setTrashMode(!trashMode)} className={`text-sm font-bold px-3 py-1 rounded ${trashMode ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{trashMode ? '휴지통' : '목록'}</button>
                </div>
                <div className="p-4 border-b border-slate-100">
                    {!trashMode && <button onClick={() => setStudentModal({open:true, id:null, name:''})} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">학생 등록</button>}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {students.filter(s => s.isDeleted === trashMode).map(s => (
                        <div key={s.id} onClick={() => !trashMode && setSelectedId(s.id)} className={`group p-4 rounded-xl border-2 flex justify-between items-center cursor-pointer ${selectedId === s.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}>
                            <span className="font-bold text-slate-800">{s.name}</span>
                            <div className="hidden group-hover:flex gap-2">
                                {!trashMode ? (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); setStudentModal({open:true, id:s.id, name:s.name}); }} className="text-xs bg-slate-200 px-2 py-1 rounded">수정</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleStudentAction(s.id, 'delete'); }} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded">삭제</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => handleStudentAction(s.id, 'restore')} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">복구</button>
                                        <button onClick={() => handleStudentAction(s.id, 'hardDelete')} className="text-xs bg-red-600 text-white px-2 py-1 rounded">완전삭제</button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* [메인 컨테이너] */}
            <main className="flex-1 flex flex-col bg-slate-50 relative">
                {current ? (
                    <>
                        <header className="h-20 bg-white border-b px-8 flex items-center justify-between z-10">
                            <h2 className="text-xl font-black">{current.name} 시간표</h2>
                            <div className="flex gap-3">
                                {!isEditMode && (
                                    <>
                                        <button onClick={() => handleExport('png')} className="px-4 py-2 bg-emerald-500 text-white rounded-lg font-bold text-sm">PNG</button>
                                        <button onClick={() => handleExport('pdf')} className="px-4 py-2 bg-indigo-500 text-white rounded-lg font-bold text-sm">PDF</button>
                                    </>
                                )}
                                <button onClick={() => setIsEditMode(!isEditMode)} className={`px-6 py-2 rounded-lg font-bold text-sm text-white ${isEditMode ? 'bg-slate-800' : 'bg-blue-600'}`}>
                                    {isEditMode ? '편집 종료' : '시간표 편집'}
                                </button>
                            </div>
                        </header>

                        <div className="flex-1 flex overflow-hidden p-6 gap-6">
                            {/* 좌측 패널: 필터 및 리스트 */}
                            <div className="w-80 flex flex-col gap-4">
                                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                    <div className="mb-6 space-y-2">
                                        <input type="text" placeholder="제목 검색" value={filterTitle} onChange={e => setFilterTitle(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none" />
                                        <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="w-full bg-slate-100 p-3 rounded-lg text-sm font-bold outline-none">
                                            <option value="">전체 태그</option>
                                            {customTags.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-2 border-t pt-4">
                                        <div className="flex justify-between items-end">
                                            <span className="text-xs font-bold text-slate-400">일주일 합산</span>
                                            <span className="text-xl font-black text-blue-600">{formatMinToTime(stats.total)}</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <span className="text-xs font-bold text-slate-400">하루 평균치</span>
                                            <span className="text-lg font-black text-slate-700">{formatMinToTime(stats.avg)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto p-4 space-y-3">
                                    <h3 className="text-xs font-black text-slate-400 mb-2">필터링된 일정 목록</h3>
                                    {filteredSchedules.map(s => (
                                        <div key={s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full" style={{backgroundColor: s.color}}></div>
                                                <span className="font-bold text-sm truncate">{s.title}</span>
                                            </div>
                                            <span className="text-xs text-slate-500 font-medium">{s.days.join(', ')} | {s.startH}:{s.startM} - {s.endH}:{s.endM}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 우측 패널: A4 캡처 대상 그리드 */}
                            <div className="flex-1 overflow-auto bg-slate-200 p-8 rounded-2xl shadow-inner relative flex justify-center custom-scrollbar">
                                <div ref={captureRef} className="export-area bg-white shadow-lg relative w-[1000px] min-w-[1000px] h-fit p-10 box-border">
                                    <div className="mb-8 flex justify-between items-end border-b-4 border-slate-900 pb-6">
                                        <h1 className="text-3xl font-black uppercase tracking-widest">{current.name} TIMETABLE</h1>
                                        <div className="flex gap-6 text-right">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Weekly Total</span>
                                                <span className="text-2xl font-black text-blue-600">{formatMinToTime(stats.total)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Daily Avg</span>
                                                <span className="text-2xl font-black text-slate-800">{formatMinToTime(stats.avg)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex border-2 border-slate-800 rounded-xl overflow-hidden bg-white">
                                        <div className="w-16 bg-slate-50 border-r-2 border-slate-800 flex flex-col text-center">
                                            <div className="h-12 border-b-2 border-slate-800"></div>
                                            {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                <div key={i} className="flex items-center justify-center text-xs font-bold text-slate-400 border-b border-slate-100 relative" style={{height: `${SLOT_HEIGHT}px`}}>
                                                    <span className="absolute top-[-8px] bg-slate-50 px-1">{START_HOUR + i}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} className="flex-1 flex flex-col relative border-r border-slate-200 last:border-r-0">
                                                <div className="h-12 border-b-2 border-slate-800 flex items-center justify-center font-black text-slate-800">{day}</div>
                                                <div className="flex-1 relative bg-white">
                                                    {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                                                        <div key={i} className="border-b border-slate-100" style={{height: `${SLOT_HEIGHT}px`}}></div>
                                                    ))}
                                                    {filteredSchedules.filter(s => s.days.includes(day)).map(s => {
                                                        const durMin = (parseInt(s.endH) * 60 + parseInt(s.endM)) - (parseInt(s.startH) * 60 + parseInt(s.startM));
                                                        return (
                                                            <div key={s.id} onClick={() => isEditMode ? setScheduleModal({open:true, id:s.id}) : setDetailModal({open:true, item:s})}
                                                                className={`absolute left-[1px] right-[1px] p-2 rounded-md shadow-sm border border-black/10 flex flex-col overflow-hidden cursor-pointer hover:brightness-95 transition-all ${isEditMode ? 'ring-2 ring-blue-500 z-10' : ''}`}
                                                                style={getRect(s)}>
                                                                <span className="font-bold text-sm text-slate-900 leading-tight truncate">{s.title}</span>
                                                                <span className="text-[10px] font-medium text-slate-800/60 mt-0.5">{s.startH}:{s.startM}</span>
                                                                {durMin >= 45 && s.tags && s.tags.length > 0 && (
                                                                    <div className="mt-auto flex flex-wrap gap-1 overflow-hidden max-h-[16px]">
                                                                        {s.tags.map(t => <span key={t} className="text-[9px] font-bold bg-white/60 px-1 rounded truncate text-slate-800">#{t}</span>)}
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
                                className="absolute bottom-10 right-10 w-16 h-16 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center text-3xl font-light hover:bg-blue-700 hover:scale-105 transition-all">+</button>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-300 font-black text-2xl tracking-widest uppercase">Select a Student</div>
                )}
            </main>

            {/* [모달: 일정 기획 (입력 폼)] */}
            {scheduleModal.open && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
                    <div className="bg-white rounded-3xl w-[600px] overflow-hidden shadow-2xl flex flex-col">
                        <div className="h-4 w-full" style={{backgroundColor: sForm.color}}></div>
                        <div className="p-8 space-y-6">
                            <input type="text" placeholder="일정 제목" value={sForm.title} onChange={e=>setSForm({...sForm, title:e.target.value})} className="w-full text-2xl font-black border-b-2 border-slate-200 pb-2 outline-none focus:border-blue-500" />
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-2 block">요일 (다중 선택)</label>
                                <div className="flex gap-2">
                                    {DAYS.map(d => (
                                        <button key={d} onClick={() => setSForm({...sForm, days: sForm.days.includes(d) ? sForm.days.filter(x=>x!==d) : [...sForm.days, d]})}
                                                className={`flex-1 py-2 rounded-lg font-bold text-sm ${sForm.days.includes(d) ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>{d}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 mb-2 block">시작 시간</label>
                                    <div className="flex gap-2"><input type="text" maxLength="2" value={sForm.startH} onChange={e=>setSForm({...sForm, startH:e.target.value})} className="w-full bg-slate-100 p-2 rounded text-center font-bold" /> : <input type="text" maxLength="2" value={sForm.startM} onChange={e=>setSForm({...sForm, startM:e.target.value})} className="w-full bg-slate-100 p-2 rounded text-center font-bold" /></div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 mb-2 block">종료 시간</label>
                                    <div className="flex gap-2"><input type="text" maxLength="2" value={sForm.endH} onChange={e=>setSForm({...sForm, endH:e.target.value})} className="w-full bg-slate-100 p-2 rounded text-center font-bold" /> : <input type="text" maxLength="2" value={sForm.endM} onChange={e=>setSForm({...sForm, endM:e.target.value})} className="w-full bg-slate-100 p-2 rounded text-center font-bold" /></div>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-2 flex justify-between">
                                    <span>태그 (다중 선택)</span>
                                    <div onDragOver={e=>e.preventDefault()} onDrop={() => { if(dragItem?.type === 'tag') setCustomTags(customTags.filter(t=>t!==dragItem.val)); setDragItem(null); }} className="text-red-400 bg-red-50 px-2 rounded flex items-center gap-1 text-[10px]"><span role="img" aria-label="trash">🗑️</span> 드래그하여 버리기</div>
                                </label>
                                <div className="flex flex-wrap gap-2 items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    {customTags.map(t => (
                                        <button key={t} draggable onDragStart={()=>setDragItem({type:'tag', val:t})} onClick={() => setSForm({...sForm, tags: sForm.tags.includes(t) ? sForm.tags.filter(x=>x!==t) : [...sForm.tags, t]})}
                                                className={`px-3 py-1 rounded-full text-xs font-bold cursor-grab active:cursor-grabbing ${sForm.tags.includes(t) ? 'bg-blue-500 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>#{t}</button>
                                    ))}
                                    <input type="text" placeholder="+ 새 태그 추가 후 Enter" onKeyDown={(e) => { if(e.key==='Enter' && e.target.value) { setCustomTags([...new Set([...customTags, e.target.value])]); e.target.value=''; } }} className="bg-transparent text-xs outline-none w-32" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-2 flex justify-between">
                                    <span>블록 색상</span>
                                    <div onDragOver={e=>e.preventDefault()} onDrop={() => { if(dragItem?.type === 'color') setCustomColors(customColors.filter(c=>c!==dragItem.val)); setDragItem(null); }} className="text-red-400 bg-red-50 px-2 rounded flex items-center gap-1 text-[10px]"><span role="img" aria-label="trash">🗑️</span> 드래그하여 버리기</div>
                                </label>
                                <div className="flex flex-wrap gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 items-center">
                                    {customColors.map(c => (
                                        <div key={c} draggable onDragStart={()=>setDragItem({type:'color', val:c})} onClick={() => setSForm({...sForm, color: c})} className={`w-6 h-6 rounded-full cursor-grab active:cursor-grabbing ${sForm.color === c ? 'ring-2 ring-offset-2 ring-slate-800' : ''}`} style={{backgroundColor: c}}></div>
                                    ))}
                                    <input type="color" className="w-6 h-6 border-0 cursor-pointer" onBlur={(e) => setCustomColors([...new Set([...customColors, e.target.value])]) } title="새 색상 추가" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-2 block">메모</label>
                                <textarea value={sForm.memo} onChange={e=>setSForm({...sForm, memo:e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm resize-none h-20 outline-none focus:border-blue-500"></textarea>
                            </div>
                        </div>
                        <div className="flex bg-slate-50">
                            <button onClick={()=>setScheduleModal({open:false, id:null})} className="flex-1 py-4 font-bold text-slate-500 hover:bg-slate-100">취소</button>
                            <button onClick={saveSchedule} className="flex-1 py-4 font-bold text-white bg-blue-600 hover:bg-blue-700">적용</button>
                        </div>
                    </div>
                </div>
            )}

            {/* [모달: 보기 모드 상세 뷰어 (수정 버튼 포함)] */}
            {detailModal.open && detailModal.item && (
                <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4 backdrop-blur-sm" onClick={()=>setDetailModal({open:false, item:null})}>
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl transform scale-100 transition-transform" onClick={e=>e.stopPropagation()}>
                        <div className="flex gap-2 mb-4">
                            {detailModal.item.tags.map(t => <span key={t} className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600">#{t}</span>)}
                        </div>
                        <h3 className="text-2xl font-black text-slate-900 mb-2">{detailModal.item.title}</h3>
                        <p className="text-sm font-bold text-slate-500 mb-6">{detailModal.item.days.join(', ')} | {detailModal.item.startH}:{detailModal.item.startM} - {detailModal.item.endH}:{detailModal.item.endM}</p>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 min-h-[100px] text-sm font-medium text-slate-700 whitespace-pre-wrap">
                            {detailModal.item.memo || '메모가 없습니다.'}
                        </div>
                        {/* [추가 연산] 보기 모드에서 바로 '수정 폼'으로 전환시키는 트리거 */}
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => {
                                setSForm(detailModal.item); 
                                setDetailModal({open:false, item:null}); 
                                setIsEditMode(true); 
                                setScheduleModal({open:true, id:detailModal.item.id});
                            }} className="flex-1 py-3 bg-blue-100 text-blue-700 font-bold rounded-xl hover:bg-blue-200 transition-colors">수정</button>
                            <button onClick={()=>setDetailModal({open:false, item:null})} className="flex-1 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors">닫기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 학생 등록/수정 모달 */}
            {studentModal.open && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
                    <div className="bg-white p-6 rounded-2xl w-80 shadow-xl">
                        <h3 className="font-bold text-lg mb-4">{studentModal.id ? '학생 이름 수정' : '신규 학생 등록'}</h3>
                        <input type="text" value={studentModal.name} onChange={e=>setStudentModal({...studentModal, name:e.target.value})} className="w-full bg-slate-100 p-3 rounded mb-4 outline-none font-bold" autoFocus onKeyDown={e=>e.key==='Enter'&&saveStudent()} />
                        <div className="flex gap-2"><button onClick={()=>setStudentModal({open:false, id:null, name:''})} className="flex-1 py-2 bg-slate-200 rounded font-bold">취소</button><button onClick={saveStudent} className="flex-1 py-2 bg-blue-600 text-white rounded font-bold">저장</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
