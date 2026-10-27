/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
function escapeHtml(value) { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
function scriptJson(value) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
module.exports = function chartTemplate({ chartJsContent, traceFile, keys, trace_data, ticks, colors, startLabel, minXVal, maxXVal }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 20px;
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .chart-container {
      margin-bottom: 20px;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 10px;
      background-color: #ffffff;
    }
    .title {
      text-align: center;
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 15px;
      color: #333;
    }
  </style>
  <script>${chartJsContent}</script>
</head>
<body>
  <div class="title">${escapeHtml(path.basename(traceFile))}</div>
  ${keys.map((key, idx) => `
    <div class="chart-container" style="height: 250px;">
      <canvas id="chart-${idx}" style="width: 100%; height: 100%;"></canvas>
    </div>
  `).join("")}

  <script>
    const traceData = ${scriptJson(trace_data)};
    const ticksInfo = ${scriptJson(ticks)};
    const colors = ${scriptJson(colors)};
    const keys = ${scriptJson(keys)};
    const startLabel = ${scriptJson(startLabel)};
    const minX = ${minXVal};
    const maxX = ${maxXVal};

    function parseCanTraceTimestampAsLocal(timestamp) {
      const match = String(timestamp).match(
        /^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?(?:Z|[+-]\\d{2}:?\\d{2})?$/
      );

      if (!match) {
        return new Date(timestamp).getTime();
      }

      const [, yearText, monthText, dayText, hoursText, minutesText, secondsText, millisecondsText = "0"] = match;
      return new Date(
        Number(yearText),
        Number(monthText) - 1,
        Number(dayText),
        Number(hoursText),
        Number(minutesText),
        Number(secondsText),
        Number(millisecondsText.padEnd(3, "0"))
      ).getTime();
    }

    function shouldUseDiscreteTickAxis(tickConfig, values) {
      if (!tickConfig || !Array.isArray(tickConfig.ticks) || !Array.isArray(tickConfig.labels)) {
        return false;
      }

      const tickValues = tickConfig.ticks.filter(value => typeof value === "number" && Number.isFinite(value));
      const dataValues = values.filter(value => typeof value === "number" && Number.isFinite(value));
      if (tickValues.length < 2 || dataValues.length === 0) {
        return false;
      }

      const tickMin = Math.min(...tickValues);
      const tickMax = Math.max(...tickValues);
      const dataMin = Math.min(...dataValues);
      const dataMax = Math.max(...dataValues);
      return dataMin >= tickMin && dataMax <= tickMax;
    }

    keys.forEach((key, idx) => {
      const data = traceData[key];
      const tickConfig = ticksInfo[key];
      const color = colors[idx % colors.length];

      const chartPoints = data.x.map((xStr, i) => ({
        x: parseCanTraceTimestampAsLocal(xStr),
        y: data.y[i]
      }));

      const ctx = document.getElementById('chart-' + idx).getContext('2d');
      
      const yAxisConfig = {
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        title: {
          display: true,
          text: key.split(':').pop(),
          font: { size: 10, weight: 'bold' }
        }
      };

      if (shouldUseDiscreteTickAxis(tickConfig, data.y)) {
        yAxisConfig.min = Math.min(...tickConfig.ticks);
        yAxisConfig.max = Math.max(...tickConfig.ticks);
        yAxisConfig.ticks = {
          stepSize: 1,
          font: { size: 9 },
          callback: function(value) {
            const valIdx = tickConfig.ticks.indexOf(value);
            return valIdx !== -1 ? tickConfig.labels[valIdx] : value;
          }
        };
      }

      new Chart(ctx, {
        type: 'scatter',
        data: {
          datasets: [{
            label: key + ' (' + data.x.length + ' pts)',
            data: chartPoints,
            borderColor: color,
            borderWidth: 0,
            showLine: false,
            fill: false,
            pointRadius: 1.5,
            pointHoverRadius: 3,
            pointBackgroundColor: color + '55',
            pointBorderColor: 'transparent',
            pointBorderWidth: 0
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { font: { size: 9, weight: 'bold' } }
            }
          },
          scales: {
            x: {
              type: 'linear',
              min: minX !== null ? minX : undefined,
              max: maxX !== null ? maxX : undefined,
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              ticks: {
                font: { size: 9 },
                callback: function(value) {
                  const date = new Date(value);
                  const hrs = String(date.getHours()).padStart(2, '0');
                  const mins = String(date.getMinutes()).padStart(2, '0');
                  const secs = String(date.getSeconds()).padStart(2, '0');
                  return hrs + ':' + mins + ':' + secs;
                }
              },
              title: {
                display: true,
                text: startLabel,
                font: { size: 10, weight: 'bold' }
              }
            },
            y: yAxisConfig
          }
        }
      });
    });
  </script>
</body>
</html>
`;

};
