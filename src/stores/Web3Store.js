import Web3 from 'web3'
import { observable, action } from 'mobx'
import { getNetworkID } from '../utils/utils'
import { CrowdsaleConfig } from '../components/Common/config'
import { CHAINS, REACT_PREFIX } from '../utils/constants'
import logdown from 'logdown'

const logger = logdown('TW:stores:Web3')

class Web3Store {
  @observable web3
  @observable curAddress
  @observable accounts

  constructor() {
    this.getWeb3(async (web3, status) => {
      if (web3) {
        this.web3 = web3
        if (typeof web3.eth.getAccounts !== 'undefined') {
          try {
            const accounts = await web3.eth.getAccounts((error, response) => {
              if (!error) return response
            })
            this.accounts = accounts
            if (accounts.length > 0) {
              this.setProperty('curAddress', accounts[0])
            }
          } catch (err) {
            logger.log('Error trying to get accounts', err)
          }
        }
      }
    })
  }

  @action
  setProperty = (property, value) => {
    this[property] = value
  }

  getInfuraLink = network => {
    const infuraTokenEnvVar = process.env[`${REACT_PREFIX}INFURA_TOKEN`]
    return `https://${network}.infura.io/${infuraTokenEnvVar}`
  }

  getWeb3 = (cb, networkIDparam) => {
    let { networkID = networkIDparam || getNetworkID() } = CrowdsaleConfig
    networkID = Number(networkID)
    let web3 = window.web3
    if (typeof web3 === 'undefined') {
      // no web3, use fallback
      logger.error('Please use a web3 browser')
      const devEnvironment = process.env.NODE_ENV === 'development'
      if (devEnvironment) {
        web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
      } else {
        let infuraLink
        switch (networkID) {
          case 1:
            infuraLink = this.getInfuraLink(CHAINS.MAINNET)
            break
          case 2:
            infuraLink = this.getInfuraLink(CHAINS.MORDEN)
            break
          case 3:
            infuraLink = this.getInfuraLink(CHAINS.ROPSTEN)
            break
          case 4:
            infuraLink = this.getInfuraLink(CHAINS.RINKEBY)
            break
          case 42:
            infuraLink = this.getInfuraLink(CHAINS.KOVAN)
            break
          default:
            infuraLink = this.getInfuraLink(CHAINS.MAINNET)
            break
        }
        const httpProvider = new Web3.providers.HttpProvider(infuraLink)
        web3 = new Web3(httpProvider)
      }

      cb(web3, false)
      return web3
    } else {
      // window.web3 == web3 most of the time. Don't override the provided,
      // web3, just wrap it in your Web3.
      const myWeb3 = new Web3(web3.currentProvider)

      cb(myWeb3, false)
      return myWeb3
    }
  }
}

export default Web3Store
