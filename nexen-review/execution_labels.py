"""Display-only execution classes. These labels never change adapter permissions."""

LOCAL_SCOPES = {
    'ollama': 'One bounded local-model draft through Local Lab; no external actions.',
    'kilo': 'One prepared, read-only Kilo draft; no code application or paid fallback.',
}
HUMAN_STATES = frozenset({'login_required', 'setup_required', 'integration_required'})
ACCOUNT_IDS = frozenset({'openrouter', 'omniroute', 'n8n', 'amboras', 'ads', 'supercool'})


def label(kind, reason, step, scope):
    return dict(execution_class=kind, execution_reason=reason,
                execution_next_step=step, execution_scope=scope)


def requirement_class(item):
    """Classify the currently recorded prerequisite, never a provider's reachability."""
    if not isinstance(item, dict):
        return label('BLOCKED', 'The required-step record is unavailable.',
                     'Refresh the connection checks.', 'No provider execution is verified.')
    step = str(item.get('action') or 'Review the recorded connection evidence.')
    if item.get('id') == 'pc2':
        return label('HUMAN', 'A physical device and its owner need to be available first.',
                     step, 'Power and connection setup; no worker dispatch is verified.')
    if isinstance(item.get('state'), str) and item['state'] in HUMAN_STATES:
        return label('HUMAN', 'The owner must complete login, account, billing or credential setup.',
                     step, 'Use the provider screen; no credentials are collected here.')
    return label('BLOCKED', 'A service check failed or a verified executor is missing.',
                 step, 'Reachability and checklist reports do not enable execution.')


def readiness_class(item, prerequisite=None, available_adapters=None):
    """Require both scoped test evidence and a current named local adapter check."""
    available = available_adapters if isinstance(available_adapters, dict) else {}
    ident = item.get('id') if isinstance(item.get('id'), str) else None
    step = str(item.get('next_step') or 'Review the saved capability evidence.')
    if ident in LOCAL_SCOPES and item.get('verified') is True and available.get(ident) is True:
        return label('AUTOMATABLE', 'An implemented local adapter is available with a successful scoped test.',
                     step, LOCAL_SCOPES[ident] + ' Start-time permissions and resource checks still apply.')
    if ident == 'pc2' and item.get('endpoint_reachable') is not True:
        return label('HUMAN', 'A physical device and its private connection need owner attention.',
                     step, 'Bring the device online; worker execution is a separate check.')
    if item.get('endpoint_reachable') is False or ident == 'phone' and item.get('verified') is not True:
        return label('BLOCKED', 'A required service or secure connection has not passed its check.',
                     step, 'No task executor is enabled by this checklist.')
    if ident in ACCOUNT_IDS and item.get('verified') is not True:
        if isinstance(prerequisite, dict) and isinstance(prerequisite.get('state'), str) and prerequisite['state'] in {'unavailable', 'verification_failed'}:
            return label('BLOCKED', 'The service must be repaired before account verification can continue.',
                         step, 'No connected executor is verified.')
        return label('HUMAN', 'Login, account setup or a scoped credential must be completed by the owner.',
                     step, 'A reachable dashboard and a reported completion are not authentication proof.')
    if ident in {'desktop', 'browser-home'} or ident in {'nexen', 'coderabbit', 'memsearch'} and (
            item.get('verified') is True or item.get('status') == 'service_reachable'):
        return label('HUMAN', 'This next step is a deliberate manual workspace or review action.',
                     step, 'Saved verification covers the stated feature; it is not an unattended executor.')
    return label('BLOCKED', 'The requested executor or its current availability has not been verified.',
                 step, 'A saved receipt alone does not dispatch a new task.')
