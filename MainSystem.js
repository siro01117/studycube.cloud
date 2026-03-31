const { useState, useMemo, useEffect, useRef } = React;

const Icon = ({ name, size = 20, className = "" }) => {
    const pascalName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const iconData = lucide.icons[pascalName] || lucide.icons[name];
    if (!iconData) return null;
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}
            dangerouslySetInnerHTML={{ __html: iconData.map(item => `<${item[0]} ${Object.entries(item[1]).map(([k, v]) => `${k}="${v}"`).join(' ')}></${item[0]}>`).join('') }}
        />
    );
};

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const START_HOUR = 7;
const END_HOUR = 24;
const SLOT_HEIGHT = 100;
const TOTAL_MINUTES = (END_HOUR - START_HOUR + 1) * 60;
const DEFAULT_COLORS = ['#E59A9A', '#E5B981', '#DEE08C', '#A8D99C', '#8CCEDB', '#89AED9', '#A59BD9', '#D9A9D9', '#C2CDC9'];

const MainSystem = () => {
    const captureRef = useRef(null);
    const [students, setStudents] = useState(() => {
        const saved = localStorage.getItem('studycube_v_final_ultra');
        return saved ? JSON.parse(saved) : [{ id: Date.now(), name: '신규 학생', schedules: [], isDeleted: false }];
    });

    const [selectedId, setSelectedId] = useState(null);
    const [activeMenuId, setActiveMenuId] = useState(null); 
    const [isEditMode, setIsEditMode] = useState(false);
    const [showTrash, setShowTrash] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTitle, setFilterTitle] = useState('');
    const [filterTag, setFilterTag] = useState('');

    const [studentModal, setStudentModal] = useState({ open: false, editId: null, name: '' });
    const [scheduleModal, setScheduleModal] = useState({ open: false, editId: null });
    const [detailModal, setDetailModal] = useState({ open: false, item: null });
    
    const [tags, setTags] = useState(['인강', '자습', '학원', '수업', '과외']);
    const [newTagInput, setNewTagInput] = useState('');
    const [customColors, setCustomColors] = useState([]);
    const [tempColor, setTempColor] = useState('#3b82f6');

    const [sForm, setSForm] = useState({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: ['자습'], memo: '', color: DEFAULT_COLORS[0] });

    useEffect(() => { localStorage.setItem('studycube_v_final_ultra', JSON.stringify(students)); }, [students]);

    const current = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);
    const filteredSchedules = useMemo(() => {
        if (!current) return [];
        return current.schedules.filter(s => 
            s.title.toLowerCase().includes(filterTitle.toLowerCase()) && 
            (filterTag === '' || (s.tags && s.tags.some(t => t.toLowerCase().includes(filterTag.toLowerCase()))))
        );
    }, [current, filterTitle, filterTag]);

    const statistics = useMemo(() => {
        const total = filteredSchedules.reduce((acc, s) => {
            const duration = (parseInt(s.endH)*60+parseInt(s.endM)) - (parseInt(s.startH)*60+parseInt(s.startM));
            return acc + (duration * s.days.length);
        }, 0);
        return { total, avg: Math.round(total / 7) };
    }, [filteredSchedules]);

    const handleExport = async () => {
        if (!captureRef.current || !current) return;
        await document.fonts.ready;
        html2canvas(captureRef.current, {
            backgroundColor: "#ffffff",
            scale: 3, 
            useCORS: true,
            allowTaint: true,
            width: 1700,
            windowWidth: 1700,
            onclone: (clonedDoc) => {
                const area = clonedDoc.querySelector('.export-area');
                if (area) {
                    area.style.height = 'auto'; area.style.overflow = 'visible';
                    area.querySelectorAll('*').forEach(el => { el.style.lineHeight = '1.2'; el.style.verticalAlign = 'baseline'; });
                    area.querySelectorAll('.stat-container').forEach(c => { c.style.display = 'flex'; c.style.alignItems = 'flex-end'; c.style.gap = '12px'; });
                }
            }
        }).then(canvas => {
            canvas.toBlob((blob) => { if (blob) saveAs(blob, `${current.name}_주간계획표.png`); }, 'image/png', 1.0);
        });
    };

    const handleSaveStudent = () => {
        if (!studentModal.name.trim()) return;
        if (studentModal.editId) {
            setStudents(prev => prev.map(s => s.id === studentModal.editId ? { ...s, name: studentModal.name } : s));
        } else {
            setStudents(prev => [...prev, { id: Date.now(), name: studentModal.name, schedules: [], isDeleted: false }]);
        }
        setStudentModal({ open: false, editId: null, name: '' });
        setActiveMenuId(null);
    };

    const openScheduleModal = (item = null) => {
        if (item) {
            setSForm({ ...item, tags: item.tags || [] });
            setScheduleModal({ open: true, editId: item.id });
        } else {
            setSForm({ title: '', days: [], startH: '09', startM: '00', endH: '10', endM: '00', tags: [tags[0]], memo: '', color: DEFAULT_COLORS[0] });
            setScheduleModal({ open: true, editId: null });
        }
    };

    const handleSaveSchedule = () => {
        if (!sForm.title || sForm.days.length === 0) return;
        const start = parseInt(sForm.startH)*60 + parseInt(sForm.startM);
        const end = parseInt(sForm.endH)*60 + parseInt(sForm.endM);
        if (end <= start) { alert("종료 시간은 시작보다 늦어야 합니다."); return; }
        const newSchedules = scheduleModal.editId 
            ? current.schedules.map(s => s.id === scheduleModal.editId ? { ...sForm, id: s.id } : s)
            : [...current.schedules, { ...sForm, id: Date.now() }];
        setStudents(prev => prev.map(s => s.id === selectedId ? { ...s, schedules: newSchedules } : s));
        setScheduleModal({ open: false, editId: null });
    };

    const toggleTag = (t) => {
        const currentTags = sForm.tags || [];
        setSForm({ ...sForm, tags: currentTags.includes(t) ? currentTags.filter(tag => tag !== t) : [...currentTags, t] });
    };

    const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans text-slate-900" onClick={() => setActiveMenuId(null)}>
            {/* 메인 레이아웃 및 사이드바 로직 동일하게 유지 */}
            <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0 z-30 shadow-md">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h1 className="text-2xl font-black italic tracking-tighter uppercase text-slate-800 mb-6 text-center">Study Cube</h1>
                    <button onClick={() => setStudentModal({ open: true, editId: null, name: '' })} className="w-full bg-blue-600 py-4 rounded-2xl font-black text-lg text-white shadow-xl flex items-center justify-center gap-3">
                        <Icon name="user-plus" size={24} /> 학생 등록
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {students.filter(s => s.isDeleted === showTrash && s.name.includes(searchQuery)).map(s => (
                        <div key={s.id} onClick={() => setSelectedId(s.id)} className={`group p-6 rounded-2xl cursor-pointer border-2 flex items-center justify-between relative transition-all ${selectedId === s.id ? 'bg-blue-50 border-blue-400' : 'bg-white border-transparent'}`}>
                            <div className="font-black text-xl truncate flex-1">{s.name}</div>
                        </div>
                    ))}
                </div>
            </aside>
            <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
                {current ? (
                    <div className="flex-1 overflow-auto bg-slate-50/50 p-12">
                         <div ref={captureRef} className="export-area bg-white p-16 rounded-[4rem] shadow-2xl mx-auto">
                            <h1 className="text-4xl font-black mb-10 tracking-tight italic uppercase">{current.name} 주간 계획표</h1>
                            <div className="grid-layout divide-x-2 divide-slate-100 border-2 border-slate-100 rounded-[3.5rem] overflow-hidden bg-white">
                                {/* 시간표 그리드 로직 생략 (기존 코드와 동일) */}
                                {DAYS.map(day => (
                                    <div key={day} className="flex flex-col relative min-w-[160px]">
                                        <div className="h-20 border-b-4 border-slate-900 flex items-center justify-center text-xl font-black bg-white">{day}</div>
                                        <div className="flex-1 relative h-[1800px]">
                                            {filteredSchedules.filter(a => a.days.includes(day)).map(a => (
                                                <div key={a.id} className="absolute left-2 right-2 rounded-2xl p-4 shadow-lg text-white" style={{ top: `${((parseInt(a.startH)*60+parseInt(a.startM)-420)/1020)*1800}px`, height: `${(((parseInt(a.endH)*60+parseInt(a.endM))-(parseInt(a.startH)*60+parseInt(a.startM)))/1020)*1800}px`, backgroundColor: a.color }}>
                                                    <div className="font-black truncate">{a.title}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                         </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                        <p className="font-black text-3xl uppercase italic">학생 데이터를 먼저 선택해 주십시오</p>
                    </div>
                )}
            </main>
        </div>
    );
};
