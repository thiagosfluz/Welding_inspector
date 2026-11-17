// Câmera: abre a traseira por padrão, permite trocar de câmera e ligar a lanterna.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.dispositivos = [];
    this.indice = -1;
    this.lanternaLigada = false;
  }

  get ativa() { return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0; }
  get largura() { return this.video.videoWidth; }
  get altura() { return this.video.videoHeight; }

  static suportada() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  async ligar(deviceId) {
    if (!Camera.suportada()) {
      throw new Error(window.isSecureContext
        ? 'Este navegador não permite acesso à câmera.'
        : 'A câmera só funciona em páginas HTTPS (ou localhost). Abra o app pelo endereço publicado.');
    }
    this.desligar();
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('Permissão da câmera negada. Libere a câmera nas configurações do navegador para este site.');
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new Error('Nenhuma câmera encontrada neste aparelho. Use “Analisar foto”.');
      if (e.name === 'NotReadableError') throw new Error('A câmera está sendo usada por outro aplicativo.');
      throw e;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    await new Promise((resolve) => {
      if (this.video.videoWidth > 0) return resolve();
      this.video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 3000);
    });
    try {
      this.dispositivos = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const atual = this.trilha()?.getSettings?.().deviceId;
      this.indice = Math.max(0, this.dispositivos.findIndex((d) => d.deviceId === atual));
    } catch { this.dispositivos = []; }
    this.lanternaLigada = false;
  }

  trilha() {
    return this.stream?.getVideoTracks()[0] || null;
  }

  desligar() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async trocar() {
    if (this.dispositivos.length < 2) return false;
    const prox = (this.indice + 1) % this.dispositivos.length;
    await this.ligar(this.dispositivos[prox].deviceId);
    this.indice = prox;
    return true;
  }

  temLanterna() {
    try { return !!this.trilha()?.getCapabilities?.().torch; } catch { return false; }
  }

  async alternarLanterna() {
    const t = this.trilha();
    if (!t) return false;
    this.lanternaLigada = !this.lanternaLigada;
    try {
      await t.applyConstraints({ advanced: [{ torch: this.lanternaLigada }] });
    } catch {
      this.lanternaLigada = false;
    }
    return this.lanternaLigada;
  }
}
