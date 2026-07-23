import { Injectable } from '@grensesnitt/grain'

@Injectable()
export class TokenService {
  isValid(token: string | undefined): boolean {
    const expected = process.env.API_TOKEN
    return expected !== undefined && token === expected
  }
}
