// SPDX-License-Identifier: MIT
// MODULES (control panel): what extends the pure core, each with a switch; a change applies on the next load.
import { useState } from 'react';
import { ToggleSwitch, Button } from 'dreamknob';
import { modulesOff, setModuleOn } from './index';
import { MODULES } from './list';

export function ModulesSection() {
  const [off, setOff] = useState(modulesOff);
  const [loaded] = useState(modulesOff);
  const changed = off.length !== loaded.length || off.some(x => !loaded.includes(x));
  return (
    <div className="cp-modules">
      {MODULES.filter(m => !m.when || m.when()).map(m => (
        <div key={m.id} className="cp-module">
          <ToggleSwitch on={!off.includes(m.id)} color="#0ECB81" label={m.label}
            onChange={on => { setModuleOn(m.id, on); setOff(modulesOff()); }} />
          <p className="cp-fine">{m.note}</p>
        </div>
      ))}
      {changed && <div className="cp-buttons"><Button color="#F7931A" onClick={() => location.reload()}>RELOAD TO APPLY</Button></div>}
      <p className="cp-fine">browseML's core is the field, the engine and this panel; a module only adds to it, and turning one off removes all of it.</p>
    </div>
  );
}
