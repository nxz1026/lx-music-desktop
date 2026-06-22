/**
 * HID设备通信模块 - 与HALO PIXELBAR音箱通信
 *
 * 设备信息:
 * - 设备名称: 花再 Halo PixelBar
 * - 包长度: 64字节
 * - 权限要求: Windows管理员权限
 */

import { buildTextPacket, buildLayoutPacket, buildUIModePacket, getWriteTestPacket, toHex, TextColor, TextLayout, UIMode } from './haloPacket'

interface HidDeviceInfo {
  path: string
  vendorId: number
  productId: number
  serialNumber: string
  manufacturerString: string
  productString: string
  releaseNumber: number
}

const DEVICE_KEYWORDS = ['halo', 'pixel', '花再', 'pixelbar']

let hidApi: typeof import('node-hid') | null = null
let hasHid = false

try {
  hidApi = require('node-hid')
  hasHid = true
} catch {
  console.log('[HaloHID] node-hid not available, running in simulated mode')
}

function normalizePath(path: any): string {
  if (typeof path === 'string') return path
  if (path instanceof Uint8Array || Buffer.isBuffer(path)) {
    return Buffer.from(path).toString('utf-8').replace(/\0/g, '')
  }
  return ''
}

export function getHasHid(): boolean {
  return hasHid
}

export function listDevices(): HidDeviceInfo[] {
  if (!hasHid || !hidApi) {
    return [{
      path: 'simulated',
      vendorId: 0x1234,
      productId: 0x5678,
      serialNumber: 'SIMULATED',
      manufacturerString: 'HALO',
      productString: 'Halo PixelBar (simulated)',
      releaseNumber: 0x0100,
    }]
  }

  return hidApi.devices().map((dev: import('node-hid').Device) => ({
    path: normalizePath(dev.path),
    vendorId: dev.vendorId,
    productId: dev.productId,
    serialNumber: dev.serialNumber ?? '',
    manufacturerString: dev.manufacturer ?? '',
    productString: dev.product ?? '',
    releaseNumber: dev.release,
  }))
}

export function findHaloDevices(): HidDeviceInfo[] {
  const allDevices = listDevices()
  return allDevices.filter(dev => {
    const name = (dev.productString || '').toLowerCase()
    return DEVICE_KEYWORDS.some(keyword => name.includes(keyword))
  })
}

function displayWidth(s: string): number {
  let width = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x1100 && code <= 0x115F) || // Hangul Jamo
      (code >= 0x2E80 && code <= 0xA4CF) || // CJK Radicals Supplement .. Yi
      (code >= 0xAC00 && code <= 0xD7A3) || // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) || // CJK Compatibility Ideographs
      (code >= 0xFE10 && code <= 0xFE19) || // Vertical Forms
      (code >= 0xFE30 && code <= 0xFE6F) || // CJK Compatibility Forms
      (code >= 0xFF01 && code <= 0xFF60) || // Fullwidth Forms
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FFFD) ||
      (code >= 0x30000 && code <= 0x3FFFD)
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

export class HaloHidCommunicator {
  private device: any = null
  private deviceInfo: HidDeviceInfo | null = null
  private connected = false
  private simulated = false

  constructor() {
    if (!hasHid) {
      this.simulated = true
      console.log('[HaloHID] Running in simulated mode')
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  connect(path?: string): boolean {
    if (this.connected) return true

    if (this.simulated) {
      this.device = 'simulated'
      this.connected = true
      console.log('[HaloHID] Simulated connect')
      return true
    }

    if (!hidApi) return false

    let candidates: HidDeviceInfo[]
    if (path) {
      const devs = listDevices().filter(d => d.path === path)
      candidates = devs
      if (!candidates.length) {
        console.log(`[HaloHID] Device not found at path: ${path}`)
        return false
      }
    } else {
      candidates = findHaloDevices()
      if (!candidates.length) {
        console.log('[HaloHID] No HALO device found')
        return false
      }
    }

    for (const devInfo of candidates) {
      try {
        const dev = new hidApi.HID(devInfo.path)
        const result = dev.write(Array.from(getWriteTestPacket()))
        if (result < 0) {
          dev.close()
          continue
        }
        this.device = dev
        this.deviceInfo = devInfo
        this.connected = true
        console.log(`[HaloHID] Connected to: ${devInfo.productString}`)
        return true
      } catch (e: any) {
        console.log(`[HaloHID] Connection attempt failed: ${e.message}`)
      }
    }

    console.log('[HaloHID] Connection failed for all candidates')
    return false
  }

  disconnect(): void {
    if (this.connected && this.device && !this.simulated) {
      try {
        this.device.close()
      } catch { /* ignore */ }
      this.device = null
      this.connected = false
      console.log('[HaloHID] Disconnected')
    } else {
      this.connected = false
    }
  }

  sendText(text: string, maxLength = 50, color: TextColor = TextColor.WHITE): boolean {
    while (displayWidth(text) > maxLength && text) {
      text = text.slice(0, -1)
    }

    const packet = buildTextPacket(text, maxLength, color)

    if (this.simulated) {
      console.log(`[HaloHID] [sim] send: ${toHex(packet).substring(0, 32)}...`)
      return true
    }

    if (!this.connected || !this.device) return false

    try {
      const result = this.device.write(Array.from(packet))
      if (result < 0) {
        console.log('[HaloHID] Write failed')
        return false
      }
      return true
    } catch (e: any) {
      console.log(`[HaloHID] Write error: ${e.message}`)
      this.connected = false
      return false
    }
  }

  sendLyricLine(text: string, maxChars = 20, color?: TextColor): boolean {
    return this.sendText(text.slice(0, maxChars), maxChars, color ?? TextColor.WHITE)
  }

  setLayout(layout: TextLayout): boolean {
    const packet = buildLayoutPacket(layout)
    if (this.simulated) return true
    if (!this.connected || !this.device) return false
    try {
      this.device.write(Array.from(packet))
      return true
    } catch {
      return false
    }
  }

  setUIMode(mode: UIMode): boolean {
    const packet = buildUIModePacket(mode)
    if (this.simulated) return true
    if (!this.connected || !this.device) return false
    try {
      this.device.write(Array.from(packet))
      return true
    } catch {
      return false
    }
  }

  clearDisplay(): boolean {
    return this.sendText(' ')
  }

  showSongInfo(songName: string, artist: string): boolean {
    const info = `${songName} - ${artist}`
    return this.sendText(info)
  }
}

export function resolveColor(colorStr: string): TextColor {
  const nameToColor: Record<string, TextColor> = {
    white: TextColor.WHITE,
    red: TextColor.RED,
    green: TextColor.GREEN,
    blue: TextColor.BLUE,
    yellow: TextColor.YELLOW,
    cyan: TextColor.CYAN,
    magenta: TextColor.MAGENTA,
  }
  return nameToColor[colorStr.toLowerCase().trim()] ?? TextColor.WHITE
}
