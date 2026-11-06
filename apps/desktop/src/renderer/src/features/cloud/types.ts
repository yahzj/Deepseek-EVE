export interface CloudProfile {
  playerId: number
  username: string | null
  nickname: string
  email?: string | null
}

export interface CloudAuthResponse extends CloudProfile {
  token: string
  recoveryCode?: string
}

export interface CloudSave {
  version: number
  data: string | null
  size?: number
  createdAt?: number
}
