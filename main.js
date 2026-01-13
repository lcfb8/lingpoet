let clusters = [];

// Load clusters.json on startup
async function loadClusters() {
  try {
    const response = await fetch('data/clusters.json');
    clusters = await response.json();
  } catch (e) {
    console.error('Failed to load clusters:', e);
    clusters = [];
  }
}

async function search(q = "") {
  const query = q.toLowerCase();
  return clusters
    .filter(c => c.key.startsWith(query))
    .slice(0, 200)
    .map(c => ({ id: c.id, key: c.key, kind: c.kind, count: c.entries.length }));
}

async function loadCluster(id) {
  const cluster = clusters.find(c => c.id === id);
  return cluster ? cluster.entries : [];
}

function renderClusters(rows){
  const out = document.getElementById("samplelangs");
  out.innerHTML = "";
  if(!rows || rows.length === 0){ out.textContent = "No results"; return; }
  rows.forEach(r=>{
    const d = document.createElement("div");
    d.className = "cluster-row";
    d.textContent = `${r.key} — ${r.kind} (${r.count} entries)`;
    d.onclick = async ()=>{
      const next = d.nextSibling;
      if(next && next.classList && next.classList.contains("cluster-entries")){ next.remove(); return; }
      const entries = await loadCluster(r.id);
      const pre = document.createElement("pre");
      pre.className = "cluster-entries";
      pre.textContent = entries.map(e=>`${e.lang}\t${e.form}\t${e.ipa||""}\t${e.gloss||""}`).join("\n");
      d.parentNode.insertBefore(pre, d.nextSibling);
    };
    out.appendChild(d);
  });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  await loadClusters();
  const btn = document.getElementById("searchBtn");
  const qinput = document.getElementById("q");
  if(btn && qinput){
    btn.onclick = async ()=>{
      const q = qinput.value.trim();
      const rows = await search(q);
      renderClusters(rows);
    };
  }
  const rows = await search("");
  renderClusters(rows);
});

d3.csv("nor-eng.csv", function(data) {
    // Create a table to display the data
    var table = d3.select("#nor-eng").append("table");
    
    // Create header row
    var thead = table.append("thead").append("tr");
    thead.selectAll("th")
        .data(d3.keys(data[0]))
        .enter()
        .append("th")
        .text(function(d) { return d; });
    
    // Create body rows
    var tbody = table.append("tbody");
    tbody.selectAll("tr")
        .data(data)
        .enter()
        .append("tr")
        .selectAll("td")
        .data(function(row) {
            return d3.keys(data[0]).map(function(key) {
                return row[key];
            });
        })
        .enter()
        .append("td")
        .text(function(d) { return d; });
});