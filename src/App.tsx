/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameCanvas } from './components/GameCanvas';

export default function App() {
  return (
    <div className="fixed inset-0 w-full h-full min-h-full overflow-hidden bg-slate-950 flex flex-col">
      <GameCanvas />
    </div>
  );
}

