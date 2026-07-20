# SYNTHIA: AI Embodiment Platform

SYNTHIA is a research platform for developing and training embodied AI agents within a high-fidelity 3D physical environment. It bridges the gap between Large Language Models (LLMs) and physical action through a real-time cognitive loop.

## Quick Start

1.  **Clone the repository**: `git clone [repo-url]`
2.  **Install dependencies**: `npm install`
3.  **Setup Machine A (Coordinator)**: `cd coordinator && npm install && npm run dev`
4.  **Setup Machine B (Frontend)**: `npm run dev`
5.  **Connect**: Open the frontend, enter your Kaggle inference URL in God Mode, and click Connect.

## System Requirements
- **Machine A**: 8GB RAM, Node.js v20+.
- **Machine B**: 4GB RAM, WebGL 2.0 compatible browser.
- **Inference**: Kaggle T4x2 GPU or equivalent (Qwen2.5-VL-7B-Instruct).

## Configuration Reference
- `src/constants/bodyTypes.ts`: Ragdoll joint hierarchies and limits.
- `src/constants/objectPresets.ts`: Physics properties for spawnable objects.
- `src/store/connectionStore.ts`: Default WebSocket and API endpoints.

## Documentation Links
- [Phase 1: Physics Engine](PHASE1_DOCS.md)
- [Phase 2: World Engine](PHASE2_DOCS.md)
- [Phase 3: Coordinator Architecture](coordinator/PHASE3_DOCS.md)
- [Phase 4: Inference Server](PHASE4_DOCS.md)
- [Phase 5: Full Integration](PHASE5_DOCS.md)
- [Setup Guide](SYNTHIA_SETUP.md)
