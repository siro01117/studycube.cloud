// Export.js: A4 Standard Export Engine
window.ExportSystem = {
    // A4 규격 상수 (Pixel at 150 DPI for High-Res)
    A4_WIDTH: 1240,
    A4_HEIGHT: 1754,

    generate: async (element, studentName, type = 'png') => {
        if (!element) return;
        
        // 폰트 및 리소스 로딩 대기
        await document.fonts.ready;

        // [시스템 렌더링] html2canvas 엔진 가동
        const canvas = await html2canvas(element, {
            scale: 2, // 해상도 배율
            useCORS: true,
            logging: false,
            width: window.ExportSystem.A4_WIDTH,
            windowWidth: window.ExportSystem.A4_WIDTH,
            onclone: (cloned) => {
                const area = cloned.querySelector('.export-area');
                if (area) {
                    area.style.width = `${window.ExportSystem.A4_WIDTH}px`;
                    area.style.minHeight = `${window.ExportSystem.A4_HEIGHT}px`;
                    area.style.display = 'block';
                }
            }
        });

        const imgData = canvas.toDataURL('image/png', 1.0);

        if (type === 'png') {
            const link = document.createElement('a');
            link.download = `[STUDYCUBE]_${studentName}_Report.png`;
            link.href = imgData;
            link.click();
        } else {
            // [PDF 엔진] jsPDF A4 설정
            const { jsPDF } = window.jspdf;
            // 'p' (portrait), 'pt' (points), 'a4' 규격 사용
            const pdf = new jsPDF('p', 'pt', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            
            // 이미지를 A4 크기에 맞게 리사이징하여 삽입
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`[STUDYCUBE]_${studentName}_Report.pdf`);
        }
    }
};
