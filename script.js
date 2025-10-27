// ====================================================================================
// script.js — Interview Master (안정 스트리밍 + 빈 줄 하트비트 무시)
//  - /generate : PDF 업로드 → 스트리밍 텍스트 → 미리보기 렌더
//  - /export/pdf-html : 미리보기의 body HTML → 서버 PDF
//  - /export/docx-html: 미리보기의 body HTML → 서버 DOCX
//  - 개선: 서버가 보내는 빈 줄("\n") 하트비트를 클라이언트에서 완전히 무시
//  - 개선: 상한 타임아웃 + 1회 재시도 + 무중단 안내 배너
// ====================================================================================

document.addEventListener('DOMContentLoaded', () => {
  // ===== 요소 참조 =====
  const uploadForm      = document.getElementById('upload-form');
  const pdfFileInput    = document.getElementById('pdf-file');
  const dropzone        = document.getElementById('dropzone');
  const fileLabelText   = document.getElementById('file-text');
  const fileNameDisplay = document.getElementById('file-name');
  const generateBtn     = document.getElementById('generate-btn');

  const loadingDiv      = document.getElementById('loading');
  const resultContainer = document.getElementById('result-container');
  const resultArea      = document.getElementById('result-area'); // 미리보기(HTML)
  const rawArea         = document.getElementById('raw-area');    // 원문(MD)
  const errorContainer  = document.getElementById('error-container');
  const errorMessage    = document.getElementById('error-message');

  const copyBtn         = document.getElementById('copy-btn');
  const pdfBtn          = document.querySelector('.download-btn[data-format="pdf"]');
  const docxBtn         = document.querySelector('.download-btn[data-format="docx"]');

  // ===== API =====
  const API_BASE    = window.API_BASE || '';
  const GENERATE    = `${API_BASE}/generate`;
  const EXPORT_PDF  = `${API_BASE}/export/pdf-html`;
  const EXPORT_DOCX = `${API_BASE}/export/docx-html`;

  // ===== 상태 =====
  let selectedFile = null;
  let rawText = '';

  // ===== 마크다운 렌더러 =====
  marked.use({ breaks: true, gfm: true });

  // ----------------------------------------------------------------------------------
  // 공통 유틸
  // ----------------------------------------------------------------------------------
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

  // ----------------------------------------------------------------------------------
  // 드래그&드롭
  // ----------------------------------------------------------------------------------
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
      fileLabelText.textContent = '여기에 놓으면 업로드됩니다!';
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
      fileLabelText.textContent = '클릭하거나 여기로 PDF를 끌어다 놓으세요';
    });
  });
  dropzone.addEventListener('drop', (e) => {
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

  // ----------------------------------------------------------------------------------
  // 생성(스트리밍) — 상한 타임아웃 + 1회 재시도 + 무중단 안내 + 빈 줄 하트비트 무시
  // ----------------------------------------------------------------------------------
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await runGenerateWithRetry(1); // 실패 시 1회 재시도
  });

  async function runGenerateWithRetry(maxRetry = 0) {
    hideResults();
    setLoadingState(true);

    if (!selectedFile) {
      setLoadingState(false);
      displayError('PDF 파일이 선택되지 않았습니다.');
      return;
    }

    let attempt = 0;
    while (true) {
      try {
        await runGenerateOnce();
        break; // 성공
      } catch (err) {
        console.error('[GENERATE] attempt failed:', err);
        if (attempt >= maxRetry) {
          if (!rawText.trim()) {
            displayError(err.message || '요청에 실패했습니다.');
          }
          break;
        }
        attempt += 1;
        // 짧은 백오프 후 재시도
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setLoadingState(false);
  }

  async function runGenerateOnce() {
    const formData = new FormData();
    formData.append('file', selectedFile);

    // 전체 상한 타임아웃 (1차 5분30초, 2차 시도는 runGenerateWithRetry가 담당)
    const OVERALL_LIMIT_MS = 330000;
    const controller = new AbortController();
    const overallTimer = setTimeout(() => controller.abort(new Error('처리가 오래 걸려 연결을 종료했습니다. 다시 시도해 주세요.')), OVERALL_LIMIT_MS);

    // “무중단 안내 배너”: 유효 데이터가 오래 안 오면 안내만 띄우고 연결은 유지
    let lastUsefulTs = Date.now();
    const INFO_BANNER_AFTER_MS = 25000; // 25초 후 안내
    let showedInfo = false;
    const watch = setInterval(() => {
      const now = Date.now();
      if (!showedInfo && now - lastUsefulTs > INFO_BANNER_AFTER_MS) {
        showedInfo = true;
        errorMessage.textContent = '분석 중입니다. 문서가 길면 시간이 걸릴 수 있어요…';
        errorContainer.classList.remove('hidden');
      }
    }, 1000);

    const response = await fetch(GENERATE, { method: 'POST', body: formData, signal: controller.signal });
    if (!response.ok) {
      clearTimeout(overallTimer); clearInterval(watch);
      throw new Error(`서버 오류: ${response.status} ${response.statusText}`);
    }

    resultContainer.classList.remove('hidden');
    resultArea.innerHTML = '';
    rawText = '';
    rawArea.textContent = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        let chunk = decoder.decode(value, { stream: true });

        // === 핵심: 빈 줄 하트비트 무시 ===
        // 서버는 10~15초마다 "\n"을 흘려보냄. 화면/저장에 영향 없도록 완전히 무시.
        if (!chunk || !chunk.trim()) {
          continue;
        }
        // ==============================

        // 유효 데이터 도착 → 안내 배너 숨김
        lastUsefulTs = Date.now();
        errorContainer.classList.add('hidden');

        rawText += chunk;
        rawArea.textContent = rawText;
        renderMarkdownToResult(rawText);
        autoScrollResult();
      }
    } finally {
      clearTimeout(overallTimer);
      clearInterval(watch);
    }

    setActionButtonsEnabled(rawText.trim().length > 0);
  }

  // ----------------------------------------------------------------------------------
  // 결과 복사
  // ----------------------------------------------------------------------------------
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

  // ----------------------------------------------------------------------------------
  // HTML 본문 추출(미리보기의 innerHTML만 전송)
  // ----------------------------------------------------------------------------------
  function currentBodyHtml() {
    return resultArea.innerHTML || '';
  }

  // ----------------------------------------------------------------------------------
  // PDF/DOCX 저장
  // ----------------------------------------------------------------------------------
  pdfBtn.addEventListener('click', async () => {
    if (!rawText.trim()) { alert('다운로드할 내용이 없습니다.'); return; }
    await exportHtml(EXPORT_PDF, pdfBtn, 'PDF 생성 중...', '.PDF로 저장', 'pdf');
  });

  docxBtn.addEventListener('click', async () => {
    if (!rawText.trim()) { alert('다운로드할 내용이 없습니다.'); return; }
    await exportHtml(EXPORT_DOCX, docxBtn, 'DOCX 생성 중...', '.DOCX로 저장', 'docx');
  });

  async function exportHtml(url, button, busyLabel, idleLabel, ext) {
    try {
      button.disabled = true;
      button.textContent = busyLabel;

      const payload = { html: currentBodyHtml() };
      const res = await fetch(url, {
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
      a.download = `면접_질문+답변.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(dlUrl);
    } catch (e) {
      console.error('[EXPORT error]', e);
      alert(e.message || '다운로드 중 오류가 발생했습니다.');
    } finally {
      button.textContent = idleLabel;
      button.disabled = false;
    }
  }
});
