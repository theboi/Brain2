/* Brain2 Console — Reports/Studio design directions, laid out on a canvas. */

function ReportsVariations() {
  const vars = getTokens('dark', 'indigo', 'inter');
  const card = { ...vars, background: 'var(--bg)' };
  const W = 1320, H = 940;
  return (
    <DesignCanvas>
      <DCSection id="reports-studio" title="Reports · Studio"
        subtitle="Four directions for the report-generation tab — AI-suggested report types tuned to the user’s persona, generated in multiple formats. Click any frame’s ⤢ to view it full-screen; the format pickers and tabs are live.">
        <DCArtboard id="a" label="A · Studio grid" width={W} height={1040} style={card}><VarStudioGrid /></DCArtboard>
        <DCArtboard id="b" label="B · Prompt-led" width={W} height={H} style={card}><VarPromptLed /></DCArtboard>
        <DCArtboard id="c" label="C · Two-pane builder" width={W} height={H} style={card}><VarBuilder /></DCArtboard>
        <DCArtboard id="d" label="D · Editorial gallery" width={W} height={H} style={card}><VarGallery /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ReportsVariations />);
