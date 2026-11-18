// Prototype B : utilityProcess. Le premier message du processus principal apporte le port ; ensuite tout passe par
// lui (process.parentPort reste pourtant accessible au plugin : voir l'ADR).
import { demarrerHote } from './runtime.mjs';

process.parentPort.once('message', (e) => demarrerHote(e.ports[0], 'B'));
