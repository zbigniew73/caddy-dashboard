import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const NOTES_PATH = path.join(DATA_DIR, 'firewall-notes.json');

function key(port, protocol) {
  return `${port}/${protocol}`;
}

function loadNotes() {
  try {
    return JSON.parse(readFileSync(NOTES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveNotes(notes) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2));
}

function getNote(port, protocol) {
  return loadNotes()[key(port, protocol)] || '';
}

function setNote(port, protocol, description) {
  const notes = loadNotes();
  const k = key(port, protocol);
  if (description) {
    notes[k] = description;
  } else {
    delete notes[k];
  }
  saveNotes(notes);
}

function deleteNote(port, protocol) {
  const notes = loadNotes();
  delete notes[key(port, protocol)];
  saveNotes(notes);
}

export { getNote, setNote, deleteNote };
