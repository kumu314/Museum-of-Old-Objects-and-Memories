import { createRoot } from 'react-dom/client';
import '../../../src/app/globals.css';
import { MuseumWorkbench } from '../../../src/features/studio/museum-workbench';
import { MemoirWorkspace } from '../../../src/features/memoir/memoir-workspace';
import { MyContributions } from '../../../src/features/contributors/my-contributions';
import { contributionInbox, id } from '../fixtures.mjs';

const root = document.getElementById('root');
if (!root) throw new Error('Browser fixture root is missing');
const view = new URLSearchParams(location.search).get('view');
createRoot(root).render(view === 'memoir' ? <MemoirWorkspace /> : view === 'contributions'
  ? <MyContributions initial={contributionInbox} /> : <MuseumWorkbench museumId={id(2)} />);
