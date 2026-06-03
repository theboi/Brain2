/* Brain2 Console — Sources + Wiki consolidation, laid out on a canvas. */

function ConsolidationCanvas() {
  const vars = getTokens('dark', 'indigo', 'inter');
  const card = { ...vars };
  const desk = { ...vars, background: 'var(--bg)' };
  const DW = 1180, DH = 720;
  return (
    <DesignCanvas>
      <DCSection id="overview" title="Sources + Wiki — one browse pattern"
        subtitle="Both pages become the same master/detail browser: a scope/filter region, a searchable list, and a drill-in detail with a back button. Mobile always opens on the list (never a page), and the active project/filter is always on screen. Three directions differ only in how the scope is surfaced — desktop mirrors the same choice. Open any frame full-screen with ⤢.">
      </DCSection>

      <DCSection id="dirA" title="A · Scope bar + filter sheet"
        subtitle="A single breadcrumb bar shows the live project ▸ filter and opens a bottom sheet with the full tree. Most compact; the current scope reads as plain text.">
        <DCArtboard id="a-src" label="Sources · list (scope always visible)" width={314} height={652} style={card}><SourcesMobile dir="A" /></DCArtboard>
        <DCArtboard id="a-sheet" label="Sources · filter sheet" width={314} height={652} style={card}><SourcesMobile dir="A" sheet /></DCArtboard>
        <DCArtboard id="a-wiki" label="Wiki · opens on the page picker" width={314} height={652} style={card}><WikiMobile dir="A" /></DCArtboard>
        <DCArtboard id="a-detail" label="Wiki · page (after tapping)" width={314} height={652} style={card}><DetailPhone kind="wiki" /></DCArtboard>
        <DCArtboard id="a-desk-s" label="Desktop · Sources (sidebar ▸ list ▸ preview)" width={DW} height={DH} style={desk}><DesktopFrame kind="sources" dir="A" /></DCArtboard>
        <DCArtboard id="a-desk-w" label="Desktop · Wiki (sidebar ▸ page)" width={DW} height={DH} style={desk}><DesktopFrame kind="wiki" dir="A" /></DCArtboard>
      </DCSection>

      <DCSection id="dirB" title="B · Filter dropdowns  ·  recommended"
        subtitle="Mobile: three compact dropdowns — Project / Tags / Status — keep the active selection in view and a tap away (tap one to pick a value). Desktop: no chip rail (the sidebar already carries scope); Tags + Status become small dropdowns under the button, and projects are collapsible trees exactly like the wiki page. Both pages are now sidebar ▸ detail.">
        <DCArtboard id="b-src" label="Sources · list (Project / Tags / Status)" width={314} height={652} style={card}><SourcesMobile dir="B" /></DCArtboard>
        <DCArtboard id="b-open" label="Sources · a filter dropdown open" width={314} height={652} style={card}><SourcesMobile dir="B" menu="status" /></DCArtboard>
        <DCArtboard id="b-wiki" label="Wiki · opens on the page picker" width={314} height={652} style={card}><WikiMobile dir="B" /></DCArtboard>
        <DCArtboard id="b-detail" label="Sources · preview (after tapping)" width={314} height={652} style={card}><DetailPhone kind="sources" /></DCArtboard>
        <DCArtboard id="b-desk-s" label="Desktop · Sources (chips + project trees)" width={DW} height={DH} style={desk}><DesktopFrame kind="sources" dir="B" /></DCArtboard>
        <DCArtboard id="b-desk-w" label="Desktop · Wiki (same shell)" width={DW} height={DH} style={desk}><DesktopFrame kind="wiki" dir="B" /></DCArtboard>
      </DCSection>

      <DCSection id="dirC" title="C · Grouped index"
        subtitle="No separate filter control — the list itself is grouped into collapsible projects, so structure communicates scope. Mirrors the existing wiki tree. Desktop pins the active project in the sidebar.">
        <DCArtboard id="c-src" label="Sources · grouped by project" width={314} height={652} style={card}><SourcesMobile dir="C" /></DCArtboard>
        <DCArtboard id="c-wiki" label="Wiki · grouped by project" width={314} height={652} style={card}><WikiMobile dir="C" /></DCArtboard>
        <DCArtboard id="c-desk" label="Desktop · Wiki with grouped sidebar" width={DW} height={DH} style={desk}><DesktopFrame kind="wiki" dir="C" /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ConsolidationCanvas />);
