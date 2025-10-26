// script.js
document.addEventListener('DOMContentLoaded', () => {
  // ---------- DOM ----------
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
  const downloadBtns    = document.querySelectorAll('.download-btn'); // [PDF, DOCX]

  // ---------- API ----------
  const API_BASE     = window.API_BASE || '';
  const GENERATE_URL = `${API_BASE}/generate`;
  const PDF_URL      = `${API_BASE}/export/pdf-html`;
  const DOCX_URL     = `${API_BASE}/export/docx-html`;

  // ---------- 상태 ----------
  let selectedFile = null;
  let rawText = '';

  // ---------- 마크다운 렌더러 ----------
  // GFM + 줄바꿈 활성화
  if (window.marked) marked.use({ gfm: true, breaks: true });

  // 안전한 렌더
  function renderMarkdown(text) {
    const md = text || '';
    const html = window.DOMPurify
      ? DOMPurify.sanitize(marked.parse(md))
      : marked.parse(md);
    resultArea.innerHTML = html;
  }

  // ---------- 공용 유틸 ----------
  function setLoading(isLoading) {
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

  function hideAll() {
    resultContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    resultArea.innerHTML = '';
    rawArea.textContent = '';
    rawText = '';
    setActionButtons(false);
  }

  function setActionButtons(enabled) {
    copyBtn.disabled = !enabled;
    downloadBtns.forEach(b => b.disabled = !enabled);
  }

  function showError(msg) {
    errorMessage.textContent = msg || '알 수 없는 오류가 발생했습니다.';
    errorContainer.classList.remove('hidden');
  }

  function autoScrollResult() {
    resultArea.scrollTop = resultArea.scrollHeight;
  }

  function setDownloadButtonState(btn, busy) {
    const fmt = btn.dataset.format; // "pdf" | "docx"
    if (busy) {
      btn.disabled = true;
      btn.textContent = (fmt === 'pdf') ? 'PDF 생성 중...' : 'DOCX 생성 중...';
    } else {
      btn.disabled = false;
      btn.textContent = (fmt === 'pdf') ? '.PDF로 저장' : '.DOCX로 저장';
    }
  }

  // ---------- 드래그&드롭 ----------
  ;['dragenter','dragover'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
      fileLabelText.textContent = '여기에 놓으면 업로드됩니다!';
    });
  });
  ;['dragleave','drop'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
      fileLabelText.textContent = '클릭하거나 여기로 PDF를 끌어다 놓으세요';
    });
  });
  dropzone.addEventListener('drop', e => {
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

  // 파일 선택
  pdfFileInput.addEventListener('change', () => {
    const file = pdfFileInput.files?.[0];
    if (file) {
      if (!file.type.startsWith('application/pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('PDF 파일만 선택해주세요.');
        pdfFileInput.value = '';
        selectedFile = null;
        generateBtn.disabled = true;
        return;
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

  // ---------- 생성 ----------
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAll();
    setLoading(true);

    if (!selectedFile) {
      setLoading(false);
      showError('PDF 파일이 선택되지 않았습니다.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(GENERATE_URL, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`서버 오류: ${res.status} ${res.statusText}`);

      resultContainer.classList.remove('hidden');
      resultArea.innerHTML = '';
      rawText = '';
      rawArea.textContent = '';

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        rawArea.textContent = rawText;
        renderMarkdown(rawText);
        autoScrollResult();
      }
      setActionButtons(rawText.trim().length > 0);
    } catch (err) {
      console.error('[GENERATE] fetch error:', err);
      showError(err.message || '요청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  });

  // ---------- 복사 ----------
  copyBtn.addEventListener('click', async () => {
    try {
      if (!rawText.trim()) { alert('복사할 결과가 없습니다.'); return; }
      await navigator.clipboard.writeText(rawText);
      alert('결과(원본 텍스트)가 클립보드에 복사되었습니다!');
    } catch (e) {
      console.error('복사 실패:', e);
      alert('복사에 실패했습니다.');
    }
  });

  // ---------- 다운로드 (PDF/DOCX) ----------
  downloadBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format; // "pdf" | "docx"
      if (!rawText.trim()) { alert('다운로드할 내용이 없습니다.'); return; }

      // 미리보기로 렌더된 HTML을 그대로 전송
      const htmlBody = resultArea.innerHTML || '';
      const url = (format === 'pdf') ? PDF_URL : DOCX_URL;

      try {
        setDownloadButtonState(btn, true);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: htmlBody })
        });

        if (!res.ok) {
          let msg = `서버 오류: ${res.status} ${res.statusText}`;
          try {
            const data = await res.json();
            if (data && data.error) msg = data.error;
          } catch (_) {}
          throw new Error(msg);
        }

        const blob = await res.blob();
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = (format === 'pdf') ? '면접_질문+답변.pdf' : '면접_질문+답변.docx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        console.error(`[DOWNLOAD ${format}]`, e);
        alert(`다운로드 중 오류: ${e.message || e}`);
      } finally {
        setDownloadButtonState(btn, false);
      }
    });
  });
});
