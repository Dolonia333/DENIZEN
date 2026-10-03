"""One evidence contract for memory, tooltips and model drafting interfaces."""

STAGES = (
    ('context', 'Context and memory', 'Your current request and selected decisions anchor this task.'),
    ('knowledge', 'Relevant knowledge and tooltips', 'Open a source to inspect its origin before relying on it.'),
    ('transcripts', 'Transcribed data and practical tips', 'Only retrieved text is available; a video filename is not a transcript.'),
    ('suggestions', 'AI suggestions', 'Model-generated suggestions must remain separate from observations.'),
    ('answer', 'Model answer', 'A model answer is a draft until checked against the evidence.'),
    ('combined', 'Combined guide', 'Combine the supported steps, contradictions and missing information into one next action.'),
)


def flow_for(packet):
    packet = packet if isinstance(packet, dict) else {}
    pool = packet.get('pool')
    label = pool.get('label') if isinstance(pool, dict) else None
    citations = packet.get('citations', [])
    citations = [item for item in citations if isinstance(item, dict)] if isinstance(citations, list) else []
    return {
        'version': 1,
        'subject': label if isinstance(label, str) and label.strip() else 'All knowledge',
        'evidence_status': packet.get('data_sufficiency', 'unknown'),
        'stages': [dict(id=ident, label=label, tooltip=tip,
                        status=('ready' if ident == 'context' else
                                'retrieved' if ident == 'knowledge' and citations else
                                'no_matching_sources' if ident == 'knowledge' else
                                'source_inspection_required' if ident == 'transcripts' else
                                'awaiting_model')) for ident, label, tip in STAGES],
        'source_count': len(citations),
        'executed': False,
    }


def answer_instructions():
    return (
        'Produce the NEXEN evidence-to-action guide in this order: '
        '1. Context and memory: current goal and relevant selected decisions. '
        '2. Knowledge and subject tips: cite supplied source IDs and explain relevant terms. '
        '3. Transcribed evidence and practical tips: distinguish actual retrieved transcripts, '
        'user notes and image observations; say when transcription is missing or uncertain. '
        '4. AI suggestions: label your new inferences and alternatives as suggestions. '
        '5. Model answer: reason from the available evidence without inventing citations. '
        '6. Combined guide: one prioritized next step, then supporting steps, prerequisites, '
        'contradictions and an observable completion check. If little relevant data exists, say so. '
        'Do not present old plans, OCR, model confidence or generated text as proof of execution, '
        'income, eligibility or investment success. This response cannot execute tools.'
    )
