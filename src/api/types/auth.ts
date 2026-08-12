export type AppEnv = {
  Variables: {
    isDebugUser: boolean
    isAdmin: boolean
    userId: string
    viewerUserId: string | null
  }
}
