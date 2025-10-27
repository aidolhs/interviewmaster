// ====================================================================================
// script.js — Interview Master
//  - (1) 업로드/스트리밍 생성 (유지)
//  - (2) 프리뷰 렌더 (유지)
//  - (3) 결과 복사 (유지)
//  - (4) PDF 저장: 오프스크린 클론을 html2pdf로 캡처 ★빈 PDF 방지
//  - (5) DOCX 저장: 서버 /export/docx-html (유지)
// ====================================================================================

document.addEventListener('DOMContentLoaded', () => {
  const uploadForm      = document.getElementById('upload-form');
  const pdfFileInput    = document.getElementById('pdf-file');
  const dropzone        = document.getElementById('dropzone');
  const fileLabelText   = document.getElementById('file-text');
  const fileNameDisplay = document.getElementById('file-name');
  const generateBtn     = document.getElementById('generate-btn');

  const loadingDiv      = document.getElementById('loading');
  const resultContainer = document.getElementById('result-container');
  const resultArea      = document.getElementById('result-area');
  const rawArea         = document.getElementById('raw-area');
  const errorContainer  = document.getElementById('error-container');
  const errorMessage    = document.getElementById('error-message');

  const copyBtn         = document.getElementById('copy-btn');
  const pdfBtn          = document.querySelector('.download-btn[data-format="pdf"]');
  const docxBtn         = document.querySelector('.download-btn[data-format="docx"]');

  const API_BASE   = window.API_BASE || '';
  const GENERATE   = `${API_BASE}/generate`;
  const EXPORT_DOCX= `${API_BASE}/export/docx-html`;

  let selectedFile = null;
  let rawText = '';

  marked.use({ breaks: true, gfm: true });

  function hideResults() {
    resultContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    resultArea.innerHTML = '';
    rawArea.textContent = '';
    rawText = '';
    setActionButtonsEnabled(false);
  }
  function setActionButtonsEnabled(enabled) {
    copyBtn.disabled = !enabled;
    pdfBtn.disabled  = !enabled;
    docxBtn.disabled = !enabled;
  }
  function setLoadingState(isLoading) {
    if (isLoading) {
      generateBtn.disabled = true;
      generateBtn.textContent = '작성 중...';
      loadingDiv.classList.remove('hidden');
    } else {
      generateBtn.disabled = false;
      generateBtn.textContent = '✨ 질문/답변 생성 시작';
      loadingDiv.classList.add('hidden');
    }
  }
  function displayError(message) {
    errorMessage.textContent = message;
    errorContainer.classList.remove('hidden');
  }
  function renderMarkdownToResult(text) {
    const html = DOMPurify.sanitize(marked.parse(text || ''));
    resultArea.innerHTML = html;
  }
  function autoScrollResult() {
    resultArea.scrollTop = resultArea.scrollHeight;
  }

  // 드래그&드롭/파일 선택 (기존 그대로)
  ['dragenter','dragover'].forEach(ev=>{
    dropzone.addEventListener(ev,(e)=>{
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
      fileLabelText.textContent = '여기에 놓으면 업로드됩니다!';
    });
  });
  ['dragleave','drop'].forEach(ev=>{
    dropzone.addEventListener(ev,(e)=>{
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
      fileLabelText.textContent = '클릭하거나 여기로 PDF를 끌어다 놓으세요';
    });
  });
  dropzone.addEventListener('drop',(e)=>{
    const items = e.dataTransfer.files;
    if (!items || !items.length) return;
    const file = items[0];
    if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
      alert('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    selectedFile = file;
    fileNameDisplay.textContent = `파일명: ${file.name}`;
    generateBtn.disabled = false;
  });

  pdfFileInput.addEventListener('change',()=>{
    const file = pdfFileInput.files[0];
    if (file) {
      if (!file.type.startsWith('application/pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('PDF 파일만 선택해주세요.');
        pdfFileInput.value = ''; selectedFile = null; generateBtn.disabled = true; return;
      }
      selectedFile = file;
      fileLabelText.textContent = '파일이 선택되었습니다!';
      fileNameDisplay.textContent = `파일명: ${file.name}`;
      generateBtn.disabled = false;
    } else {
      selectedFile = null;
      fileLabelText.textContent = '클릭하거나 여기로 PDF를 끌어다 놓으세요';
      fileNameDisplay.textContent = '';
      generateBtn.disabled = true;
    }
  });

  // 생성 스트리밍 (기존 그대로)
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideResults();
    setLoadingState(true);

    if (!selectedFile) {
      setLoadingState(false);
      displayError('PDF 파일이 선택되지 않았습니다.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(GENERATE, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(`서버 오류: ${response.status} ${response.statusText}`);

      resultContainer.classList.remove('hidden');
      resultArea.innerHTML = '';
      rawText = '';
      rawArea.textContent = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        rawArea.textContent = rawText;
        renderMarkdownToResult(rawText);
        autoScrollResult();
      }
      setActionButtonsEnabled(rawText.trim().length > 0);
    } catch (err) {
      console.error('[GENERATE fetch error]', err);
      displayError(err.message || '요청에 실패했습니다.');
    } finally {
      setLoadingState(false);
    }
  });

  // 결과 복사 (기존 그대로)
  copyBtn.addEventListener('click', async () => {
    try {
      if (!rawText.trim()) { alert('복사할 결과가 없습니다.'); return; }
      await navigator.clipboard.writeText(rawText);
      alert('결과(원본 텍스트)가 클립보드에 복사되었습니다!');
    } catch (err) {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    }
  });

  // ==========================
  // ★ PDF 저장 — 오프스크린 클론을 캡처
  // ==========================
  function makePrintableClone(sourceEl) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-100000px'; // 화면 밖
    wrapper.style.top = '0';
    wrapper.style.width = '794px';    // A4 폭(96dpi 기준) 근사값
    wrapper.style.background = '#fff';

    const clone = sourceEl.cloneNode(true);
    // 스크롤/높이 제한 제거
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    clone.style.height = 'auto';
    clone.style.background = '#fff';
    clone.style.padding = '16px';

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return { wrapper, clone };
  }

  pdfBtn.addEventListener('click', async () => {
    if (!rawText.trim()) { alert('다운로드할 내용이 없습니다.'); return; }

    pdfBtn.disabled = true;
    pdfBtn.textContent = 'PDF 생성 중...';

    const { wrapper, clone } = makePrintableClone(resultArea);
    try {
      const opt = {
        margin:       [10, 10, 10, 10],
        filename:     '면접_질문+답변.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth:  wrapper.offsetWidth,
          windowHeight: wrapper.scrollHeight
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css', 'legacy'] }
      };
      await html2pdf().set(opt).from(clone).save();
    } catch (e) {
      console.error('[PDF export error]', e);
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      wrapper.remove(); // 오프스크린 클론 정리
      pdfBtn.textContent = '.PDF로 저장';
      pdfBtn.disabled = false;
    }
  });

  // DOCX 저장 (기존 그대로)
  docxBtn.addEventListener('click', async () => {
    if (!rawText.trim()) { alert('다운로드할 내용이 없습니다.'); return; }
    try {
      docxBtn.disabled = true;
      docxBtn.textContent = 'DOCX 생성 중...';

      const payload = { html: resultArea.innerHTML || '' };
      const res = await fetch(`${EXPORT_DOCX}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = `서버 오류: ${res.status} ${res.statusText}`;
        try {
          const data = await res.json();
          if (data && data.error) msg = `다운로드 중 오류: ${data.error}`;
        } catch (_) {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = '면접_질문+답변.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(dlUrl);
    } catch (e) {
      console.error('[DOCX export error]', e);
      alert(e.message || '다운로드 중 오류가 발생했습니다.');
    } finally {
      docxBtn.textContent = '.DOCX로 저장';
      docxBtn.disabled = false;
    }
  });
});
