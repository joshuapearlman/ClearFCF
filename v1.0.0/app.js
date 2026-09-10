const elements = {
  screenBtn: document.getElementById('screenBtn'),
  exportBtn: document.getElementById('exportBtn'),
  resetHistoryBtn: document.getElementById('resetHistoryBtn'),
  universe: document.getElementById('universe'),
  manualTickers: document.getElementById('manualTickers'),
  skipReviewed: document.getElementById('skipReviewed'),
  table: document.getElementById('screenerTable'),
  tableBody: document.getElementById('tableBody'),
  loading: document.getElementById('loading'),
  modal: document.getElementById('auditModal'),
  closeModal: document.getElementById('closeModal'),
  auditContent: document.getElementById('auditContent')
};

let currentResults = [];

// History Management
const getDismissed = () => JSON.parse(localStorage.getItem('fcf_dismissed') || '[]');
const addDismissed = (ticker) => {
  const list = new Set(getDismissed());
  list.add(ticker);
  localStorage.setItem('fcf_dismissed', JSON.stringify([...list]));
};
const clearDismissed = () => localStorage.removeItem('fcf_dismissed');

elements.resetHistoryBtn.addEventListener('click', () => {
  clearDismissed();
  alert('Review history cleared.');
});

elements.closeModal.addEventListener('click', () => elements.modal.classList.add('hidden'));

elements.screenBtn.addEventListener('click', async () => {
  elements.loading.classList.remove('hidden');
  elements.table.classList.add('hidden');
  elements.exportBtn.disabled = true;

  try {
    let tickersToScreen = [];
    
    if (elements.manualTickers.value.trim()) {
      tickersToScreen = elements.manualTickers.value.split(',').map(t => t.trim());
    } else {
      const universeRes = await fetch(`/api/universe?type=${elements.universe.value}`);
      const universeData = await universeRes.json();
      tickersToScreen = universeData.symbols.map(s => s.ticker);
    }

    if (elements.skipReviewed.checked) {
      const dismissed = new Set(getDismissed());
      tickersToScreen = tickersToScreen.filter(t => !dismissed.has(t));
    }

    // Process in batches of 10 as per API rules
    currentResults = [];
    for (let i = 0; i < tickersToScreen.length; i += 10) {
      const batch = tickersToScreen.slice(i, i + 10);
      const res = await fetch('/api/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: batch })
      });
      const data = await res.json();
      if (data.results) currentResults.push(...data.results);
    }

    renderTable();
    elements.exportBtn.disabled = false;
  } catch (error) {
    alert('Screening failed: ' + error.message);
  } finally {
    elements.loading.classList.add('hidden');
  }
});

function renderTable() {
  elements.tableBody.innerHTML = '';
  currentResults.forEach(item => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td><strong>${item.ticker}</strong></td>
      <td>${item.companyName}</td>
      <td>${item.status}</td>
      <td>$${item.price?.toFixed(2) || 'N/A'}</td>
      <td>${item.priceToNfcf ? item.priceToNfcf.toFixed(1) + 'x' : 'N/A'}</td>
      <td>${item.fcfYield ? (item.fcfYield * 100).toFixed(1) + '%' : 'N/A'}</td>
      <td title="${(item.warnings || []).join('\n')}">${item.warnings?.length || 0} Warnings</td>
      <td class="action-cell">
        <button class="audit-btn" onclick="openAudit('${item.ticker}')">Audit</button>
        <button class="danger-btn" onclick="dismissTicker('${item.ticker}', this)">✕ Pass</button>
      </td>
    `;
    elements.tableBody.appendChild(row);
  });
  elements.table.classList.remove('hidden');
}

window.dismissTicker = (ticker, btn) => {
  addDismissed(ticker);
  btn.closest('tr').remove();
};

window.openAudit = async (ticker) => {
  elements.auditContent.innerHTML = 'Loading audit data...';
  elements.modal.classList.remove('hidden');
  try {
    const res = await fetch(`/api/analyze?ticker=${ticker}`);
    const data = await res.json();
    elements.auditContent.innerHTML = `
      <h2>${data.companyName} (${data.ticker}) Audit Report</h2>
      <div class="audit-grid">
        <div class="audit-card">
          <h3>Valuation</h3>
          <p>Price: $${data.valuation.price}</p>
          <p>Market Cap: $${(data.valuation.marketCap / 1e9).toFixed(2)}B</p>
          <p>P/nFCF: ${data.valuation.priceToNfcf?.toFixed(2)}x</p>
        </div>
        <div class="audit-card">
          <h3>Quality Metrics</h3>
          <p>Reliability: ${data.quality.reliability}</p>
          <p>FCF Trajectory: ${data.quality.fcfTrajectory}</p>
        </div>
      </div>
      <div class="warnings">
        <h3>Warnings</h3>
        <ul>${data.warnings.map(w => `<li>${w}</li>`).join('') || '<li>None</li>'}</ul>
      </div>
    `;
  } catch (err) {
    elements.auditContent.innerHTML = 'Failed to load audit data.';
  }
};

elements.exportBtn.addEventListener('click', () => {
  const headers = ['Ticker', 'Name', 'Status', 'Price', 'P/nFCF', 'FCF Yield'];
  const csvContent = [
    headers.join(','),
    ...currentResults.map(r => `"${r.ticker}","${r.companyName}","${r.status}",${r.price},${r.priceToNfcf},${r.fcfYield}`)
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fcf_screener_results.csv';
  a.click();
});