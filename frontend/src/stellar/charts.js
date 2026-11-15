/**
 * Chart.js with the error-bar plugin, loaded only when a chart tab is first opened
 * (keeps the Stellar View's first load small). Colours follow the design tokens.
 */
let loading = null;

export const DETECTOR_COLOURS = ['#0072B2', '#56B4E9', '#009E73', '#F0E442', '#E69F00', '#D55E00'];
const VISIT_COLOURS = ['#00B5BC', '#F0B200', '#E45950', '#56B4E9', '#E69F00', '#009E73', '#CC79A7', '#F0E442'];
export const visitColour = (visit) => VISIT_COLOURS[(visit - 1) % VISIT_COLOURS.length];

/** @returns {Promise<typeof import('chart.js').Chart>} */
export function loadChart() {
  loading ??= (async () => {
    const chart = await import('chart.js');
    const errorBars = await import('chartjs-chart-error-bars');
    const { Chart, LinearScale, Tooltip, Legend } = chart;
    Chart.register(errorBars.ScatterWithErrorBarsController, errorBars.PointWithErrorBar, LinearScale, Tooltip, Legend);
    Chart.defaults.color = '#E8EEF7';
    Chart.defaults.borderColor = '#1E3256';
    Chart.defaults.font.family = '"Exo 2 Variable", "Segoe UI", sans-serif';
    Chart.defaults.animation = false; // points stream in; animating each would lag
    return Chart;
  })();
  return loading;
}

/**
 * A scatter chart with error bars.
 * @param {HTMLCanvasElement} canvas
 * @param {{xLabel: string, yLabel: string, xTicks?: (value: number) => string,
 *          tooltip: (point: object) => string}} options
 */
export async function createScatter(canvas, { xLabel, yLabel, xTicks, tooltip }) {
  const Chart = await loadChart();
  return new Chart(canvas, {
    type: 'scatterWithErrorBars',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: xLabel }, ticks: xTicks ? { callback: xTicks } : {} },
        y: { type: 'linear', title: { display: true, text: yLabel } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (context) => tooltip(context.raw) } },
      },
    },
  });
}
