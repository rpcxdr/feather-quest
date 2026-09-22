/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameCanvas } from './components/GameCanvas';

export default function App() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 flex flex-col">
      <GameCanvas />
    </div>
  );
}

