import OBSWebSocket from "obs-websocket-js";

export type ConnectionChangeHandler = (connected: boolean) => void;
export type SceneChangeHandler = (sceneName: string) => void;
export type SceneListChangeHandler = (sceneNames: string[]) => void;

export class ObsController {
  private obs = new OBSWebSocket();
  private knownScenes = new Set<string>();
  private knownTransitions: string[] = [];
  private currentScene: string | null = null;
  private connectionHandlers: ConnectionChangeHandler[] = [];
  private sceneHandlers: SceneChangeHandler[] = [];
  private sceneListHandlers: SceneListChangeHandler[] = [];

  constructor() {
    this.obs.on("CurrentProgramSceneChanged", ({ sceneName }) => {
      this.currentScene = sceneName;
      this.sceneHandlers.forEach((h) => h(sceneName));
    });

    this.obs.on("SceneListChanged", ({ scenes }) => {
      this.knownScenes = new Set(scenes.map((s) => String(s.sceneName)));
      const sceneNames = [...this.knownScenes];
      this.sceneListHandlers.forEach((h) => h(sceneNames));
    });

    this.obs.on("ConnectionClosed", () => {
      console.error("[obs] connection closed unexpectedly");
      this.connectionHandlers.forEach((h) => h(false));
    });
  }

  async connect(url: string, password: string): Promise<void> {
    await this.obs.connect(url, password || undefined);

    const { scenes, currentProgramSceneName } = await this.obs.call("GetSceneList");
    this.knownScenes = new Set(scenes.map((s) => String(s.sceneName)));
    this.currentScene = currentProgramSceneName;

    const { transitions } = await this.obs.call("GetSceneTransitionList");
    this.knownTransitions = transitions.map((t) => String((t as { transitionName: string }).transitionName));
  }

  async reconnect(url: string, password: string): Promise<void> {
    try {
      await this.obs.disconnect();
    } catch {
      // already disconnected, nothing to clean up
    }
    await this.connect(url, password);
  }

  onConnectionChange(handler: ConnectionChangeHandler): void {
    this.connectionHandlers.push(handler);
  }

  onSceneChange(handler: SceneChangeHandler): void {
    this.sceneHandlers.push(handler);
  }

  onSceneListChange(handler: SceneListChangeHandler): void {
    this.sceneListHandlers.push(handler);
  }

  getCurrentScene(): string | null {
    return this.currentScene;
  }

  listScenes(): string[] {
    return [...this.knownScenes];
  }

  hasScene(sceneName: string): boolean {
    return this.knownScenes.has(sceneName);
  }

  listTransitions(): string[] {
    return [...this.knownTransitions];
  }

  async switchScene(sceneName: string): Promise<void> {
    await this.obs.call("SetCurrentProgramScene", { sceneName });
  }

  async switchSceneWithTransition(sceneName: string, transitionName: string): Promise<void> {
    await this.obs.call("SetCurrentSceneTransition", { transitionName });
    await this.obs.call("SetCurrentProgramScene", { sceneName });
  }

  async disconnect(): Promise<void> {
    await this.obs.disconnect();
  }
}
