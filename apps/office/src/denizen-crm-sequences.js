'use strict';

const { sendCrmEmail, nextId } = require('./denizen-crm-email');

function daysBetween(startIso, endDate = new Date()) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((endDate.getTime() - start.getTime()) / 86400000);
}

function findContact(state, contactId) {
  return (state.contacts || []).find((c) => String(c?.id) === String(contactId)) || null;
}

function enrollContact(state, sequenceId, contactId) {
  const sequences = Array.isArray(state.sequences) ? [...state.sequences] : [];
  const seq = sequences.find((s) => String(s?.id) === String(sequenceId));
  if (!seq) return { ok: false, error: 'Sequence not found' };

  const contact = findContact(state, contactId);
  if (!contact) return { ok: false, error: 'Contact not found' };

  const enrollments = Array.isArray(state.sequenceEnrollments) ? [...state.sequenceEnrollments] : [];
  const exists = enrollments.find(
    (e) => String(e.sequenceId) === String(sequenceId)
      && String(e.contactId) === String(contactId)
      && e.status === 'active',
  );
  if (exists) return { ok: false, error: 'Contact already enrolled', state };

  const enrollment = {
    id: nextId(enrollments),
    sequenceId: seq.id,
    contactId: contact.id,
    enrolledAt: new Date().toISOString(),
    stepIndex: 0,
    lastStepAt: null,
    status: 'active',
  };
  enrollments.push(enrollment);

  const seqIdx = sequences.findIndex((s) => String(s.id) === String(sequenceId));
  if (seqIdx >= 0) {
    sequences[seqIdx] = {
      ...sequences[seqIdx],
      enrolledCount: (Number(sequences[seqIdx].enrolledCount) || 0) + 1,
    };
  }

  return {
    ok: true,
    enrollment,
    state: { ...state, sequences, sequenceEnrollments: enrollments },
  };
}

async function processEnrollment(state, enrollment, senderName) {
  const sequences = Array.isArray(state.sequences) ? state.sequences : [];
  const seq = sequences.find((s) => String(s?.id) === String(enrollment.sequenceId));
  if (!seq || !seq.active || enrollment.status !== 'active') {
    return { state, changed: false };
  }

  const steps = Array.isArray(seq.steps) ? seq.steps : [];
  if (enrollment.stepIndex >= steps.length) {
    return { state, changed: false };
  }

  const step = steps[enrollment.stepIndex];
  const days = daysBetween(enrollment.enrolledAt);
  if (days < Number(step.day) || 0) {
    return { state, changed: false };
  }

  let nextState = state;
  let changed = false;
  const contact = findContact(state, enrollment.contactId);
  const now = new Date().toISOString();

  if (step.type === 'email') {
    const body = step.body || `Hi {{name}},\n\n${step.subject || ''}\n\n— {{sender.name}}`;
    const result = await sendCrmEmail(nextState, {
      contactId: enrollment.contactId,
      subject: step.subject,
      body,
      senderName: senderName || 'Sequences',
    });
    if (!result.ok) {
      return { state, changed: false, error: result.error };
    }
    nextState = result.state;
    changed = true;
  } else if (step.type === 'task') {
    const tasks = Array.isArray(nextState.tasks) ? [...nextState.tasks] : [];
    const title = step.title || step.subject || 'Sequence task';
    const dup = tasks.some((t) => !t.done && t.title === title && t.contact === contact?.name);
    if (!dup) {
      tasks.push({
        id: nextId(tasks),
        title,
        contact: contact?.name || '',
        due: now.slice(0, 10),
        priority: 'Medium',
        done: false,
        status: 'todo',
        createdAt: now.slice(0, 10),
      });
      nextState = { ...nextState, tasks };
      changed = true;
    }
  }

  const enrollments = Array.isArray(nextState.sequenceEnrollments)
    ? nextState.sequenceEnrollments.map((e) => ({ ...e }))
    : [];
  const idx = enrollments.findIndex((e) => String(e.id) === String(enrollment.id));
  if (idx < 0) return { state: nextState, changed };

  const nextIndex = enrollment.stepIndex + 1;
  const completed = nextIndex >= steps.length;
  enrollments[idx] = {
    ...enrollments[idx],
    stepIndex: nextIndex,
    lastStepAt: now,
    status: completed ? 'completed' : 'active',
    completedAt: completed ? now : null,
  };

  const sequencesCopy = Array.isArray(nextState.sequences) ? [...nextState.sequences] : [];
  const sIdx = sequencesCopy.findIndex((s) => String(s.id) === String(seq.id));
  if (completed && sIdx >= 0) {
    sequencesCopy[sIdx] = {
      ...sequencesCopy[sIdx],
      completedCount: (Number(sequencesCopy[sIdx].completedCount) || 0) + 1,
    };
    nextState = { ...nextState, sequences: sequencesCopy };
  }

  nextState = { ...nextState, sequenceEnrollments: enrollments };
  return { state: nextState, changed: true };
}

async function tickSequences(state, senderName) {
  const enrollments = Array.isArray(state.sequenceEnrollments)
    ? state.sequenceEnrollments.filter((e) => e.status === 'active')
    : [];
  if (!enrollments.length) return { state, changed: false };

  let nextState = state;
  let changed = false;
  for (const enrollment of enrollments) {
    const result = await processEnrollment(nextState, enrollment, senderName);
    if (result.changed) {
      nextState = result.state;
      changed = true;
    }
  }
  return { state: nextState, changed };
}

module.exports = {
  enrollContact,
  tickSequences,
  daysBetween,
};
