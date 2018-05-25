import React, { Component } from 'react'
import { inject, observer } from 'mobx-react'
import { TOAST, VALIDATION_TYPES } from '../../utils/constants'
import '../../assets/stylesheets/application.css'
import {
  successfulFinalizeAlert,
  successfulUpdateCrowdsaleAlert,
  warningOnFinalizeCrowdsale,
  notTheOwner
} from '../../utils/alerts'
import {
  getCurrentAccount,
  getNetworkVersion,
  sendTXToContract,
  calculateGasLimit,
  attachToSpecificCrowdsaleContract,
  methodToExec,
  getCrowdsaleStrategy
} from '../../utils/blockchainHelpers'
import { toast } from '../../utils/utils'
import { getWhiteListWithCapCrowdsaleAssets } from '../../stores/utils'
import { getFieldsToUpdate, processTier, updateTierAttribute } from './utils'
import { Loader } from '../Common/Loader'
import { getTiers } from '../crowdsale/utils'
import { generateContext } from '../stepFour/utils'
import { toJS } from 'mobx'
import { Form } from 'react-final-form'
import arrayMutators from 'final-form-arrays'
import createDecorator from 'final-form-calculate'
import { AboutCrowdsale } from './AboutCrowdsale'
import { FinalizeCrowdsaleStep } from './FinalizeCrowdsaleStep'
import { DistributeTokensStep } from './DistributeTokensStep'
import { ManageForm } from './ManageForm'
import moment from 'moment'

const { VALID } = VALIDATION_TYPES

@inject(
  'crowdsaleStore',
  'web3Store',
  'tierStore',
  'contractStore',
  'generalStore',
  'tokenStore',
  'gasPriceStore'
)
@observer
export class Manage extends Component {
  constructor (props) {
    super(props)
    this.state = {
      formPristine: true,
      loading: true,
      canFinalize: false,
      ownerCurrentUser: false
    }

    this.initialTiers = []
  }

  componentDidMount () {
    setTimeout(() => window.scrollTo(0, 0), 500)
  }

  componentWillMount () {
    const { crowdsaleStore, generalStore, match, tierStore } = this.props
    const crowdsaleExecID = match.params.crowdsaleExecID
    console.log("crowdsaleExecID:", crowdsaleExecID)

    crowdsaleStore.setSelectedProperty('execID', crowdsaleExecID)
    crowdsaleStore.setProperty('execID', crowdsaleExecID)

    // networkID
    getNetworkVersion().then(networkID => {
      generalStore.setProperty('networkID', networkID)
      getWhiteListWithCapCrowdsaleAssets(networkID)
        .then(_newState => { this.setState(_newState) })
        .then(() => getCrowdsaleStrategy(crowdsaleExecID))
        .then((strategy) => crowdsaleStore.setProperty('strategy', strategy))
        //.then((strategy) => crowdsaleStore.setProperty('strategy', CROWDSALE_STRATEGIES.DUTCH_AUCTION)) // to do
        .then(this.extractContractsData)
        .then(() => {
          this.initialTiers = JSON.parse(JSON.stringify(tierStore.tiers))
          console.log("strategy:", crowdsaleStore.strategy)
        })
    })
  }

  componentWillUnmount () {
    const { tierStore, tokenStore, crowdsaleStore } = this.props
    tierStore.reset()
    tokenStore.reset()
    crowdsaleStore.reset()
  }

  checkOwner = async () => {
    const { contractStore, web3Store, crowdsaleStore } = this.props

    const targetPrefix = "initCrowdsale"
    const targetSuffix = crowdsaleStore.contractTargetSuffix
    const target = `${targetPrefix}${targetSuffix}`

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { addr } = toJS(contractStore.registryStorage)
    const ownerAccount = await methods.getAdmin(addr, contractStore.crowdsale.execID).call()
    const accounts = await web3Store.web3.eth.getAccounts()

    const ownerCurrentUser = accounts[0] === ownerAccount
    this.setState({ ownerCurrentUser })

    if (!ownerCurrentUser) notTheOwner()
  }

  extractContractsData = () => {
    const { crowdsaleStore, contractStore, match } = this.props
    contractStore.setContractProperty('crowdsale', 'execID', match.params.crowdsaleExecID)

    return getTiers()
      .then(numOfTiers => {
        console.log("numOfTiers:", numOfTiers)
        return getCurrentAccount()
          .then(account => {
            contractStore.setContractProperty('crowdsale', 'account', account)
            const targetPrefix = "initCrowdsale"
            const targetSuffix = crowdsaleStore.contractTargetSuffix
            const target = `${targetPrefix}${targetSuffix}`
            return attachToSpecificCrowdsaleContract(target)
              .then((initCrowdsaleContract) => {
                console.log(initCrowdsaleContract)
                let registryStorageObj = toJS(contractStore.registryStorage)
                let whenCrowdsaleData = [];
                let whenCrowdsale = initCrowdsaleContract.methods.getCrowdsaleInfo(registryStorageObj.addr, contractStore.crowdsale.execID).call();
                whenCrowdsaleData.push(initCrowdsaleContract)
                whenCrowdsaleData.push(whenCrowdsale)
                let whenToken = initCrowdsaleContract.methods.getTokenInfo(registryStorageObj.addr, contractStore.crowdsale.execID).call();
                whenCrowdsaleData.push(whenToken)
                const whenReservedTokensDestinations = crowdsaleStore.isMintedCappedCrowdsale ? initCrowdsaleContract.methods.getReservedTokenDestinationList(registryStorageObj.addr, contractStore.crowdsale.execID).call() : null;
                whenCrowdsaleData.push(whenReservedTokensDestinations)

                if (crowdsaleStore.isMintedCappedCrowdsale) {
                  for (let tierNum = 0; tierNum < numOfTiers; tierNum++) {
                    let whenTierData = initCrowdsaleContract.methods.getCrowdsaleTier(registryStorageObj.addr, contractStore.crowdsale.execID, tierNum).call();
                    let whenTierDates = initCrowdsaleContract.methods.getTierStartAndEndDates(registryStorageObj.addr, contractStore.crowdsale.execID, tierNum).call();
                    whenCrowdsaleData.push(whenTierData);
                    whenCrowdsaleData.push(whenTierDates);
                  }
                } else if (crowdsaleStore.isDutchAuction) {
                  let whenDutchAuctionData = initCrowdsaleContract.methods.getCrowdsaleStatus(registryStorageObj.addr, contractStore.crowdsale.execID).call();
                  let whenDutchAuctionDates = initCrowdsaleContract.methods.getCrowdsaleStartAndEndTimes(registryStorageObj.addr, contractStore.crowdsale.execID).call();
                  whenCrowdsaleData.push(whenDutchAuctionData);
                  whenCrowdsaleData.push(whenDutchAuctionDates);
                }
                return Promise.all(whenCrowdsaleData)
              })
              .then((crowdsaleData) => {
                console.log("crowdsaleData:");
                console.log(crowdsaleData);
                let initCrowdsaleContract = crowdsaleData[0];
                let crowdsale = crowdsaleData[1];
                let token = crowdsaleData[2];
                let reservedTokensDestinationsObj = crowdsaleData[3];

                crowdsaleData.shift(); //initCrowdsaleContract
                crowdsaleData.shift(); //crowdsale
                crowdsaleData.shift(); //token
                crowdsaleData.shift(); //reservedTokensDestinationsObj

                let tiers = [];
                let tierExtendedObj = {};
                let tiersAndDates = crowdsaleData.slice();
                console.log("tiersAndDates:", tiersAndDates)
                tiersAndDates.reduce((prevEl, curEl, index) => {
                  let isTierObj = curEl.hasOwnProperty("tier_name")
                  if (index == 1) {
                    tierExtendedObj = Object.assign(prevEl, curEl)
                    tiers.push(tierExtendedObj)
                    tierExtendedObj = {}
                  } else {
                    if (!isTierObj) {
                      tierExtendedObj = Object.assign(tierExtendedObj, curEl)
                      tiers.push(tierExtendedObj)
                      tierExtendedObj = {}
                    } else {
                      tierExtendedObj = curEl
                    }
                  }
                  return curEl
                })
                console.log("tiers:")
                console.log(tiers)

                let registryStorageObj = toJS(contractStore.registryStorage)

                //get reserved tokens info
                let reservedTokensDestinations = []
                let whenReservedTokensInfoArr = [];
                if (crowdsaleStore.isMintedCappedCrowdsale) {
                  reservedTokensDestinations = reservedTokensDestinationsObj.reserved_destinations
                  for (let dest = 0; dest < reservedTokensDestinationsObj.reserved_destinations.length; dest++) {
                    let destination = reservedTokensDestinations[dest]
                    console.log("destination:", destination)
                    let whenReservedTokensInfo = initCrowdsaleContract.methods.getReservedDestinationInfo(registryStorageObj.addr, contractStore.crowdsale.execID, destination).call()
                    whenReservedTokensInfoArr.push(whenReservedTokensInfo);
                  }
                }

                //get whitelists for tiers
                let whenWhiteListsData = [];
                let method
                if (crowdsaleStore.isMintedCappedCrowdsale) {
                  for (let tierNum = 0; tierNum < numOfTiers; tierNum++) {
                    method = initCrowdsaleContract.methods.getTierWhitelist(registryStorageObj.addr, contractStore.crowdsale.execID, tierNum).call()
                    if (tiers[tierNum].whitelist_enabled) {
                      whenWhiteListsData.push(method);
                    } else {
                      whenWhiteListsData.push(null);
                    }
                  }
                } else if (crowdsaleStore.isDutchAuction) {
                  method = initCrowdsaleContract.methods.getCrowdsaleWhitelist(registryStorageObj.addr, contractStore.crowdsale.execID).call()
                  whenWhiteListsData.push(method);
                }

                let whenTotalData = whenReservedTokensInfoArr.concat(whenWhiteListsData)
                console.log("whenTotalData:", whenTotalData)
                console.log("whenReservedTokensInfoArr.length:", whenReservedTokensInfoArr.length)
                console.log("whenWhiteListsData.length:", whenWhiteListsData.length)

                return Promise.all(whenTotalData)
                  .then((totalData) => {
                    console.log("totalData:", totalData)
                    let whiteListsData = []
                    let reservedTokensInfoRaw = []
                    if (whenReservedTokensInfoArr.length > 0) {
                      reservedTokensInfoRaw = totalData.slice(0, whenReservedTokensInfoArr.length);
                      whiteListsData = totalData.slice(whenReservedTokensInfoArr.length);
                    } else {
                      whiteListsData = totalData.slice()
                    }
                    console.log("whiteListsData:", whiteListsData)

                    const fillWhiteListPromises = (tierNum) => {
                      for (let whiteListItemNum = 0; whiteListItemNum < whiteListsData[tierNum].whitelist.length; whiteListItemNum++) {
                        let newWhitelistPromise = new Promise((resolve) => {
                          let method
                          if (crowdsaleStore.isMintedCappedCrowdsale) {
                            method = initCrowdsaleContract.methods.getWhitelistStatus(registryStorageObj.addr, contractStore.crowdsale.execID, tierNum, whiteListsData[tierNum].whitelist[whiteListItemNum]).call()
                          } else if (crowdsaleStore.isDutchAuction) {
                            method = initCrowdsaleContract.methods.getWhitelistStatus(registryStorageObj.addr, contractStore.crowdsale.execID, whiteListsData[tierNum].whitelist[whiteListItemNum]).call()
                          }
                          method
                            .then(whitelistStatus => {
                              if (whitelistStatus.max_spend_remaining > 0) {
                                let whitelistItem = {
                                  addr: whiteListsData[tierNum].whitelist[whiteListItemNum],
                                  min: whitelistStatus.minimum_contribution,
                                  max: whitelistStatus.max_spend_remaining
                                }
                                tiers[tierNum].whitelist = []
                                tiers[tierNum].whitelist.push(whitelistItem)
                              }
                              resolve();
                            })
                        })
                        whitelistPromises.push(newWhitelistPromise)
                      }
                    }

                    let whitelistPromises = []
                    if (crowdsaleStore.isMintedCappedCrowdsale) {
                      for (let tierNum = 0; tierNum < numOfTiers; tierNum++) {
                        if (tiers[tierNum].whitelist_enabled) {
                          fillWhiteListPromises(tierNum)
                        }
                      }
                    } else if (crowdsaleStore.isDutchAuction) {
                      fillWhiteListPromises(0)
                    }

                    console.log("reservedTokensInfoRaw:", reservedTokensInfoRaw)
                    let reservedTokensInfo = []
                    for (let dest = 0; dest < reservedTokensInfoRaw.length; dest++) {
                      let reservedTokensInfoObj = reservedTokensInfoRaw[dest]
                      if (reservedTokensInfoObj.num_tokens > 0) {
                        reservedTokensInfo.push(
                          {
                            addr: reservedTokensDestinations[dest],
                            dim: "tokens",
                            val: Number(reservedTokensInfoObj.num_tokens) / `1e${token.token_decimals}`
                          }
                        )
                      }
                      if (reservedTokensInfoObj.num_percent > 0) {
                        reservedTokensInfo.push(
                          {
                            addr: reservedTokensDestinations[dest],
                            dim: "percentage",
                            val: Number(reservedTokensInfoObj.num_percent) / `1e${reservedTokensInfoObj.percent_decimals}`
                          }
                        )
                      }
                    }
                    return Promise.all(whitelistPromises)
                      .then(() => {
                        console.log(tiers)
                        return tiers.reduce((promise, tier, index) => {
                          return promise.then(() => processTier(tier, crowdsale, token, reservedTokensInfo, index))
                        }, Promise.resolve())
                      })
                  })
                  .catch((err) => {
                    console.log(tiers)
                    return tiers.reduce((promise, tier, index) => {
                      return promise.then(() => processTier(tier, crowdsale, token, [], index))
                    }, Promise.resolve())
                  })
              })
              .then(this.updateCrowdsaleStatus)
              .catch(err => {
                this.hideLoader()
                console.log(err)
              })
              .then(this.hideLoader)
          })
          .catch(err => {
            console.log(err)
            this.hideLoader()
          })
      })
      .catch(err => {
        console.log(err)
        this.hideLoader()
      })
  }

  hideLoader = () => {
    this.setState({ loading: false })
  }

  showLoader = () => {
    this.setState({ loading: true })
  }

  updateCrowdsaleStatus = () => {
    return this.setCrowdsaleInfo()
      .then(this.canFinalize)
      .then(this.checkOwner)
  }

  setCrowdsaleInfo = async () => {
    const { contractStore, crowdsaleStore } = this.props

    const targetPrefix = "initCrowdsale"
    const targetSuffix = crowdsaleStore.contractTargetSuffix
    const target = `${targetPrefix}${targetSuffix}`

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { addr } = toJS(contractStore.registryStorage)
    const { end_time } = await methods.getCrowdsaleStartAndEndTimes(addr, contractStore.crowdsale.execID).call()

    console.log("crowdsaleStartAndEndTimes.end_time:", end_time)
    this.setState({ crowdsaleHasEnded: end_time * 1000 <= Date.now() || crowdsaleStore.selected.finalized })
  }

  canFinalize = async () => {
    const { contractStore, crowdsaleStore } = this.props

    const targetPrefix = "initCrowdsale"
    const targetSuffix = crowdsaleStore.contractTargetSuffix
    const target = `${targetPrefix}${targetSuffix}`

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { getCrowdsaleInfo, isCrowdsaleFull } = methods
    const { addr } = toJS(contractStore.registryStorage)

    try {
      const { is_finalized } = await getCrowdsaleInfo(addr, contractStore.crowdsale.execID).call()
      const { is_crowdsale_full } = await isCrowdsaleFull(addr, contractStore.crowdsale.execID).call()

      if (is_finalized) {
        this.setState({ canFinalize: false })
      } else {
        const { crowdsaleHasEnded } = this.state

        this.setState({
          canFinalize: crowdsaleHasEnded || is_crowdsale_full
        })
      }
    } catch (e) {
      console.error(e)
      this.setState({ canFinalize: false })
    }
  }

  getFinalizeCrowdsaleParams = (methodInterface) => {
    const { web3Store } = this.props
    const { web3 } = web3Store

    let context = generateContext(0);
    let encodedParameters = web3.eth.abi.encodeParameters(methodInterface, [context]);
    return encodedParameters;
  }

  finalizeCrowdsale = () => {
    this.updateCrowdsaleStatus()
      .then(() => {
        const { crowdsaleStore } = this.props

        if (!crowdsaleStore.selected.finalized && this.state.canFinalize) {
          warningOnFinalizeCrowdsale()
            .then(result => {
              if (result.value) {
                this.showLoader()

                getCurrentAccount()
                  .then(account => {
                    const methodInterface = ["bytes"]

                    let methodName
                    let targetPrefix
                    if (crowdsaleStore.isMintedCappedCrowdsale) {
                      methodName = "finalizeCrowdsaleAndToken"
                      targetPrefix = "tokenConsole"
                    } else if (crowdsaleStore.isDutchAuction) {
                      methodName = "finalizeCrowdsale"
                      targetPrefix = "crowdsaleConsole"
                    }
                    const targetSuffix = crowdsaleStore.contractTargetSuffix
                    const target = `${targetPrefix}${targetSuffix}`

                    let paramsToExec = [methodInterface]
                    const method = methodToExec("scriptExec", `${methodName}(${methodInterface.join(',')})`, target, this.getFinalizeCrowdsaleParams, paramsToExec)

                    let opts = {
                      gasPrice: this.props.generalStore.gasPrice,
                      from: account
                    }

                    method.estimateGas(opts)
                      .then(estimatedGas => {
                        console.log("estimatedGas:",estimatedGas)
                        opts.gasLimit = calculateGasLimit(estimatedGas)
                        return sendTXToContract(method.send(opts))
                      })
                      .then(() => {
                        crowdsaleStore.setSelectedProperty('finalized', true)
                        this.setState({ canFinalize: false }, () => {
                          successfulFinalizeAlert().then(() => {
                            this.setState({ loading: true })
                            setTimeout(() => window.location.reload(), 500)
                          })
                        })
                      })
                      .catch((err) => {
                        console.log(err)
                        toast.showToaster({ type: TOAST.TYPE.ERROR, message: TOAST.MESSAGE.FINALIZE_FAIL })
                      })
                      .then(this.hideLoader)
                  })
              }
            })
        }
      })
      .catch(console.error)
  }

  canBeSaved = () => {
    const { crowdsaleHasEnded, ownerCurrentUser } = this.state
    const { tierStore, crowdsaleStore } = this.props
    const { updatable } = crowdsaleStore.selected

    const updatableTiersMintedCappedCrowdsale = crowdsaleStore.selected.initialTiersValues.filter(tier => tier.updatable)
    const updatableTiers = crowdsaleStore.isMintedCappedCrowdsale ? updatableTiersMintedCappedCrowdsale : crowdsaleStore.isDutchAuction ? crowdsaleStore.selected.initialTiersValues : []
    const isValidTier = tierStore.individuallyValidTiers
    const validTiers = updatableTiers.every(tier => isValidTier[tier.index])

    let fieldsToUpdate = []
    if (updatableTiers.length && validTiers) {
      fieldsToUpdate = getFieldsToUpdate(updatableTiers, tierStore.tiers)
    }

    let canSave = ownerCurrentUser && (tierStore.modifiedStoredWhitelist || fieldsToUpdate.length > 0) && !crowdsaleHasEnded && updatable

    const canSaveObj = {
      canSave,
      fieldsToUpdate
    }

    return canSaveObj
  }

  saveCrowdsale = () => {
    const canSaveObj = this.canBeSaved()
    if (!canSaveObj.canSave) return;

    this.showLoader()

    this.updateCrowdsaleStatus()
      .then(() => {
        console.log("fieldsToUpdate:", canSaveObj.fieldsToUpdate)

        canSaveObj.fieldsToUpdate
          .reduce((promise, { key, newValue, tier }) => {
            return promise.then(() => updateTierAttribute(key, newValue, tier))
          }, Promise.resolve())
          .then(() => {
            this.hideLoader()
            successfulUpdateCrowdsaleAlert()
          })
          .catch(err => {
            console.log(err)
            this.hideLoader()
            toast.showToaster({ type: TOAST.TYPE.ERROR, message: TOAST.MESSAGE.TRANSACTION_FAILED })
          })

      })
      .catch(error => {
        console.error(error)
        this.hideLoader()
      })
  }

  updateTierStore = ({ values }) => {
    const { tierStore } = this.props
    values.tiers.forEach((tier, index) => {
      tierStore.setTierProperty(tier.endTime, 'endTime', index)
    })
  }

  calculator = createDecorator({
    field: /.+\.endTime/,
    updates: (value, name, allValues) => {
      const nextTierIndex = +name.match(/(\d+)/)[1] + 1
      const { tierStore } = this.props
      const newValue = {}


      if (tierStore.tiers[nextTierIndex]) {
        const currentEnd = moment(allValues.tiers[nextTierIndex].endTime)
        const currentStart = moment(allValues.tiers[nextTierIndex].startTime)
        const duration = moment.duration(currentEnd.diff(currentStart)).as('minutes')
        const nextEnd = moment(value).add(duration, 'm').format('YYYY-MM-DDTHH:mm')

        newValue[`tiers[${nextTierIndex}].startTime`] = value
        newValue[`tiers[${nextTierIndex}].endTime`] = nextEnd
      }

      return newValue
    }
  })

  render () {
    const { canFinalize, ownerCurrentUser } = this.state
    const { generalStore, tokenStore, crowdsaleStore } = this.props
    const { finalized } = crowdsaleStore.selected
    const { execID } = crowdsaleStore

    return (
      <section className="manage">

        <FinalizeCrowdsaleStep
          disabled={!ownerCurrentUser || finalized || !canFinalize}
          handleClick={this.finalizeCrowdsale}
        />

        <DistributeTokensStep
          owner={ownerCurrentUser}
          disabled={!ownerCurrentUser}
          handleClick={this.distributeReservedTokens}
        />

        <Form
          onSubmit={this.saveCrowdsale}
          mutators={{ ...arrayMutators }}
          decorators={[this.calculator]}
          initialValues={{ tiers: this.initialTiers, }}
          component={ManageForm}
          canEditTiers={ownerCurrentUser && !canFinalize && !finalized}
          crowdsaleStore={crowdsaleStore}
          decimals={tokenStore.decimals}
          aboutTier={
            <AboutCrowdsale
              name={tokenStore.name}
              ticker={tokenStore.ticker}
              execID={execID}
              networkID={generalStore.networkID}
            />
          }
          handleChange={this.updateTierStore}
          canSave={this.canBeSaved().canSave}
        />

        <Loader show={this.state.loading}/>

      </section>
    )
  }
}
